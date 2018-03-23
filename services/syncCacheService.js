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
        let locker = {};

        while (buckets.length) {

          await Promise.map(this.web3s, async (web3, index) => {
            return await this.runPeer(web3, buckets, locker, index);
          });
        }

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
      let lockerChunks = _.keys(locker);
      let newChunkToLock = _.chain(buckets).reject(item => _.find(lockerChunks, lock => _.isEqualWith(lock, item))).head().value();
      if (newChunkToLock) {
        locker[web3.index] = newChunkToLock;

        await Promise.mapSeries(buckets[index], async (blockNumber) => {
          let block = await getBlock(web3, blockNumber);
          await blockModel.findOneAndUpdate({number: block.number}, block, {upsert: true});
          _.pull(buckets[index], blockNumber);
          this.events.emit('block', block);
        }).catch(() => {
          delete locker[web3.index];
        });
        buckets = _.filter(buckets, bucket => bucket.length);

      }

    }
  }

};

module.exports = SyncCacheService;