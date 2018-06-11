/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  syncCacheServiceInterface = require('middleware-common-components/interfaces/blockProcessor/syncCacheServiceInterface'),
  allocateBlockBuckets = require('../utils/allocateBlockBuckets'),
  models = require('../models'),
  getBlock = require('../utils/getBlock'),
  providerService = require('../services/providerService'),
  addBlock = require('../utils/addBlock'),
  log = bunyan.createLogger({name: 'app.services.syncCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class SyncCacheService {

  constructor () {
    this.events = new EventEmitter();
  }

  async start () {
    await this.indexCollection();
    let data = await allocateBlockBuckets();
    this.doJob(data.missedBuckets);
    return data.height;
  }

  async indexCollection () {
    log.info('indexing...');
    await models.blockModel.init();
    await models.txModel.init();
    await models.txLogModel.init();
    log.info('indexation completed!');
  }

  async doJob (buckets) {

    while (buckets.length)
      try {
        for (let bucket of buckets) {
          await this.runPeer(bucket);
          if (!bucket.length)
            _.pull(buckets, bucket);
        }

        this.events.emit('end');

      } catch (err) {
        log.error(err);
      }

    this.events.emit('end');

  }

  async runPeer (bucket) {

    let web3 = await providerService.get();

    const lastBlock = await Promise.promisify(web3.eth.getBlock)(_.last(bucket), false).timeout(60000);


    if (!lastBlock || (_.last(bucket) !== 0 && !lastBlock.number))
      return await Promise.delay(10000);

    log.info(`web3 provider took chuck of blocks ${bucket[0]} - ${_.last(bucket)}`);

    let blocksToProcess = [];
    for(let blockNumber = _.last(bucket); blockNumber >= bucket[0]; blockNumber--)
      blocksToProcess.push(blockNumber);

    await Promise.mapSeries(blocksToProcess, async (blockNumber) => {
      const block = await getBlock(blockNumber);

      await addBlock(block);
      _.pull(bucket, blockNumber);
      this.events.emit('block', block);
    });

  }
}

module.exports = function (...args) {
  return syncCacheServiceInterface(new SyncCacheService(...args));
};
