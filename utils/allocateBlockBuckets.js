const _ = require('lodash'),
  config = require('../config'),
  bunyan = require('bunyan'),
  Promise = require('bluebird'),
  log = bunyan.createLogger({name: 'app.utils.allocateBlockBuckets'}),
  blockModel = require('../models/blockModel');

module.exports = async function (web3s) {

  const currentBlock = await blockModel.findOne({network: config.web3.network}, {number: 1}, {sort: {number: -1}});
  const currentCacheHeight = _.get(currentBlock, 'number', -1);

  let blockNumbers = [];
  for (let i = 0; i < currentCacheHeight; i++)
    blockNumbers.push(i);

  const blockNumberChunks = _.chunk(blockNumbers, 10000);
  let missedBuckets = [];
  const missedBlocks = [];

  for (let blockNumberChunk of blockNumberChunks) {
    log.info(`validating blocks from: ${_.head(blockNumberChunk)} to ${_.last(blockNumberChunk)}`);
    const count = await blockModel.count({network: config.web3.network, number: {$in: blockNumberChunk}});
    if (count !== blockNumberChunk.length && count)
      missedBuckets.push(blockNumberChunk);
    if (!count)
      for (let blockNumber of blockNumberChunk)
        missedBlocks.push(blockNumber);
  }

  for (let missedBucket of missedBuckets)
    for (let blockNumber of missedBucket) {
      log.info(`validating block: ${blockNumber}`);
      const isExist = await blockModel.count({network: config.web3.network, number: blockNumber});
      if (!isExist)
        missedBlocks.push(blockNumber);
    }

  let currentNodesHeight = await Promise.mapSeries(web3s, async web3 => await Promise.promisify(web3.eth.getBlockNumber)().timeout(10000).catch(() => -1));
  const currentNodeHeight = _.chain(currentNodesHeight).reject(height => height === -1)
    .max()
    .defaults(-1)
    .value();

  for (let i = currentCacheHeight + 1; i < currentNodeHeight - config.consensus.lastBlocksValidateAmount; i++)
    missedBlocks.push(i);

  missedBuckets = _.chain(missedBlocks).reverse().chunk(10000).value();

  if (currentNodeHeight === -1)
    return Promise.reject({code: 0});

  return {missedBuckets: missedBuckets, height: currentNodeHeight - config.consensus.lastBlocksValidateAmount < 0 ? 0 : currentNodeHeight - config.consensus.lastBlocksValidateAmount};

};
