/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  allocateBlockBuckets = require('../utils/allocateBlockBuckets'),
  blockModel = require('../models/blockModel'),
  txModel = require('../models/txModel'),
  getBlock = require('../utils/getBlock'),
  addBlock = require('../utils/addBlock'),
  log = bunyan.createLogger({name: 'app.services.syncCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class SyncCacheService {

  constructor (web3s) {
    this.web3s = web3s;
    this.events = new EventEmitter();
    this.isSyncing = true;
  }

  async start () {
    await this.indexCollection();
    let data = await allocateBlockBuckets(this.web3s);
    this.doJob(data.missedBuckets);
    return data.height;
  }

  async indexCollection () {
    log.info('indexing...');
    await blockModel.init();
    await txModel.init();
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

        if (err instanceof Promise.AggregateError) {
          console.log(err);
          log.error('all nodes are down or not synced!');
          process.exit(0);
        }

        log.error(err);

      }
    this.events.emit('end');

  }

  async runPeer (bucket) {

    let lastBlock = await Promise.any(this.web3s.map(async (web3) => {
      const lastBlock = await Promise.promisify(web3.eth.getBlock)(_.last(bucket), false).timeout(60000);

      if (!_.has(lastBlock, 'number'))
        return Promise.reject();

      return lastBlock.number;
    }));

    if (!lastBlock)
      return await Promise.delay(10000);

    log.info(`web3 provider took chuck of blocks ${bucket[0]} - ${_.last(bucket)}`);

    let blocksToProcess = [];
    for(let blockNumber = bucket[0]; blockNumber <= _.last(bucket); blockNumber++)
      blocksToProcess.push(blockNumber);

    await Promise.map(blocksToProcess, async (blockNumber) => {
      const data = await Promise.any(this.web3s.map(async (web3) => {
        const block = await getBlock(web3, blockNumber);
        const unconfirmedBlock = await Promise.promisify(web3.eth.getBlock)('pending', false);
        return {block: block, unconfirmedBlock: unconfirmedBlock};
      }));

      await addBlock(data.block, data.unconfirmedBlock, 0);
      _.pull(bucket, blockNumber);
      this.events.emit('block', data.block);
    }, {concurrency: this.web3s.length}).catch((e) => {
      if (e && e.code === 11000)
        _.pull(bucket, bucket[0]);
    });

  }
}

module.exports = SyncCacheService;
