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
  allocateBlockBuckets = require('../utils/blocks/allocateBlockBuckets'),
  models = require('../models'),
  getBlock = require('../utils/blocks/getBlock'),
  providerService = require('../services/providerService'),
  addBlock = require('../utils/blocks/addBlock'),
  config = require('../config'),
  log = bunyan.createLogger({name: 'core.blockProcessor.services.syncCacheService', level: config.logs.level});

/**
 * @service
 * @description sync the blockchain history
 * @returns {Promise.<*>}
 */

class SyncCacheService {

  constructor() {
    this.events = new EventEmitter();
  }

  /** @function
   * @description start syncing process
   * @return {Promise<*>}
   */
  async start() {
    await this.indexCollection();
    let data = await allocateBlockBuckets();
    this.doJob(data.missedBuckets);
    return data.height;
  }

  async indexCollection() {
    log.info('indexing...');
    await models.blockModel.init();
    await models.txModel.init();
    await models.txLogModel.init();
    log.info('indexation completed!');
  }

  /**
   * @function
   * @description process the buckets
   * @param buckets - array of blocks
   * @return {Promise<void>}
   */
  async doJob(buckets) {

    while (buckets.length)
      try {
        for (let bucket of buckets) {

          if (bucket.length === 2 && bucket.length !== (_.last(bucket) > bucket[0] ? _.last(bucket) - bucket[0] : bucket[0] - _.last(bucket)) + 1) {

            let blocksToProcess = [];
            for (let blockNumber = _.last(bucket); blockNumber >= bucket[0]; blockNumber--)
              blocksToProcess.push(blockNumber);

            _.pullAll(bucket, bucket);
            bucket.push(...blocksToProcess);
          }

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

  /**
   * @function
   * @description process the bucket
   * @param bucket
   * @return {Promise<*>}
   */
  async runPeer(bucket) {

    let web3 = await providerService.get();

    const lastBlock = await Promise.promisify(web3.eth.getBlock)(_.last(bucket), false).timeout(60000);


    if (!lastBlock || (_.last(bucket) !== 0 && !lastBlock.number))
      return await Promise.delay(10000);

    log.info(`web3 provider took chuck of blocks ${bucket[0]} - ${_.last(bucket)}`);

    await Promise.mapSeries(bucket, async (blockNumber) => {
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
