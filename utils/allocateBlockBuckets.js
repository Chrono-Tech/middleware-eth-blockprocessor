const _ = require('lodash'),
  config = require('../config'),
  bunyan = require('bunyan'),
  Promise = require('bluebird'),
  log = bunyan.createLogger({name: 'app.utils.allocateBlockBuckets'}),
  blockModel = require('../models/blockModel');

module.exports = async function (web3s) {

  const currentBlocks = await blockModel.find({network: config.web3.network}).sort('-number').limit(1);
  const currentCacheHeight = _.chain(currentBlocks).get('0.number', -1).value();

  let blockNumbers = [];
  for (let i = 0; i < currentCacheHeight; i++)
    blockNumbers.push(i);

  const blockNumberChunks = _.chunk(blockNumbers, 100000);
  let missedBuckets = [];
  const missedBlocks = [];

  for (let blockNumberChunk of blockNumberChunks) {
    log.info(`validating blocks from: ${_.head(blockNumberChunk)} to ${_.last(blockNumberChunk)}`);
    const count = await blockModel.count({network: config.web3.network, number: {$in: blockNumberChunk}});
    if (count !== blockNumberChunk.length)
      missedBuckets.push(blockNumberChunk);
  }

  for (let missedBucket of missedBuckets)
    for (let blockNumber of missedBucket) {
      log.info(`validating block: ${blockNumber}`);
      const isExist = await blockModel.count({network: config.web3.network, number: blockNumber});
      if (!isExist)
        missedBlocks.push(blockNumber);
    }

  let currentNodesHeight = await Promise.mapSeries(web3s, async web3 => await Promise.promisify(web3.eth.getBlockNumber)().timeout(10000).catch(() => -1));
  const deltaEqualHeight = _.chain(currentNodesHeight).reject(height => height === -1)
    .max()
    .thru(item => _.isUndefined(item) ? -1 : item)
    .value();

  for (let i = currentCacheHeight + 1; i < deltaEqualHeight - config.consensus.lastBlocksValidateAmount; i++)
    missedBlocks.push(i);

  missedBuckets = _.chain(missedBlocks).reverse().chunk(10000).value();

  if (deltaEqualHeight === -1)
    return Promise.reject({code: 0});

  return {missedBuckets: missedBuckets, height: deltaEqualHeight};

};
