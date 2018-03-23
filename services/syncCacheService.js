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


const runPeer = async (web3, buckets, locker, index) => {

  while (buckets.length) {
    let lockerChunks = _.keys(locker);
    let newChunkToLock = _.chain(buckets).reject(item => _.find(lockerChunks, lock => _.isEqualWith(lock, item))).head().value();
    if (newChunkToLock) {
      locker[web3.index] = newChunkToLock;

      await Promise.mapSeries(buckets[index], async (blockNumber) => {
        let block = await getBlock(web3, blockNumber);
        log.info(`${block.hash} ${block.number} added to cache by connection ${index}`);
        await blockModel.findOneAndUpdate({number: block.number}, block, {upsert: true});
        _.pull(buckets[index], blockNumber);
      }).catch(() => {
        delete locker[web3.index];
      });
      buckets = _.filter(buckets, bucket => bucket.length);

    }

  }

};

module.exports = async (web3s) => {

  let isSyncing = true;

  while (isSyncing) {
    try {
      let buckets = await allocateBlockBuckets(web3s);
      let locker = {};

      while (buckets.length) {

        await Promise.map(web3s, async (web3, index) => {
          return await runPeer(web3, buckets, locker, index);
        });
      }

    } catch (e) {
      if (_.get(e, 'code') === 0) {
        log.info('nodes are down or not synced!');
        process.exit(0);
      }
    }
  }
};