/**
 * Block processor
 * @module services/blockProcess
 */
const _ = require('lodash'),
  Promise = require('bluebird'),
  filterTxsByAccountService = require('./filterTxsByAccountService');

/**
 * Block processor routine
 * @param  {number} currentBlock Current block
 * @param  {Object} web3         Latest block from network
 * @param  {array} lastBlocks    Previous hashes of blocks (the number is defined in config)
 * @return {array}               Filtered transactions
 */

module.exports = async (currentBlock, web3, lastBlocks) => {
  /**
   * Get latest block number from network
   * @type {number}
   */
  let block = await Promise.promisify(web3.eth.getBlockNumber)();

  if (block === currentBlock) //heads are equal
    return Promise.reject({code: 0});

  if (block === 0) {
    let syncState = await Promise.promisify(web3.eth.getSyncing)();
    if (syncState.currentBlock !== 0)
      return Promise.reject({code: 0});
  }

  if (block < currentBlock)
    return Promise.reject({code: 1}); //head has been blown off

  const lastBlockHashes = await Promise.mapSeries(lastBlocks, async blockHash => await Promise.promisify(web3.eth.getBlock)(blockHash, false));

  if (_.compact(lastBlockHashes).length !== lastBlocks.length)
    return Promise.reject({code: 1}); //head has been blown off

  /**
   * Get raw block
   * @type {Object}
   */
  let rawBlock = await Promise.promisify(web3.eth.getBlock)(currentBlock + 1, true);

  if (!rawBlock.transactions || _.isEmpty(rawBlock.transactions))
    return Promise.reject({code: 2});

  let txsReceipts = await Promise.map(rawBlock.transactions, tx =>
    Promise.promisify(web3.eth.getTransactionReceipt)(tx.hash), {concurrency: 1});

  rawBlock.transactions = rawBlock.transactions.map(tx => {
    tx.logs = _.chain(txsReceipts)
      .find({transactionHash: tx.hash})
      .get('logs', [])
      .value();
    return tx;
  });

  const filteredTxs = await filterTxsByAccountService(rawBlock.transactions);
  return {
    block: rawBlock,
    filteredTxs: filteredTxs
  };
};
