const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  allocateBlockBuckets = require('../utils/allocateBlockBuckets'),
  blockModel = require('../models/blockModel'),
  web3Errors = require('web3/lib/web3/errors'),
  getBlock = require('../utils/getBlock'),
  log = bunyan.createLogger({name: 'app.services.blockCacheService'});

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

    while (this.isSyncing) {
      try {
        let buckets = await allocateBlockBuckets(this.web3s);
        let locker = {stack: {}, lock: false};

        while (buckets.length) {

          await Promise.map(this.web3s, async (web3, index) => {
            return await this.runPeer(web3, buckets, locker, index);
          });
        }

        this.isSyncing = false;

      } catch (e) {
        if (_.get(e, 'code') === 0) {
          log.info('nodes are down or not synced!');
          process.exit(0);
        }
      }
    }
  }

  async runPeer (web3, buckets, locker, index) {

    while (buckets.length) {
      if (locker.lock) {
        await Promise.delay(1000);
        continue;
      }

      locker.lock = true;
      let lockerChunks = _.values(locker.stack);
      let newChunkToLock = _.chain(buckets).reject(item =>
        _.find(lockerChunks, lock => lock[0] === item[0])
      ).head().value();

      let lastBlock = await Promise.promisify(web3.eth.getBlock)(_.last(newChunkToLock), true).timeout(1000).catch(() => null);
      locker.lock = false;

      if (!newChunkToLock || !lastBlock) {
        delete locker.stack[index];
        await Promise.delay(10000);
        continue;
      }

      console.log('process', index, 'took chuck started with', newChunkToLock[0]);
      locker.stack[index] = newChunkToLock;
      await Promise.mapSeries(newChunkToLock, async (blockNumber) => {
        let block = await getBlock(web3, blockNumber);
        await blockModel.findOneAndUpdate({number: block.number}, block, {upsert: true});
        _.pull(newChunkToLock, blockNumber);
        this.events.emit('block', block);
      }).catch((e) => {
        if (e && e.code === 11000) {
          console.log(e);
          _.pull(newChunkToLock, newChunkToLock[0]);
        }
      });

      if (!newChunkToLock.length)
        _.pull(buckets, newChunkToLock);

      delete locker.stack[index];

    }
  }
}

module.exports = SyncCacheService;