const _ = require('lodash'),
  Promise = require('bluebird'),
  filterTxsByAccountService = require('./filterTxsByAccountService');

module.exports = async (currentBlock, web3) => {

  let block = await Promise.promisify(web3.eth.getBlockNumber)();

  if (block <= currentBlock)
    return Promise.reject({code: 0});

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

  return await filterTxsByAccountService(rawBlock.transactions);
};