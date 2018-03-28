const config = require('../config'),
  Promise = require('bluebird'),
  _ = require('lodash');

module.exports = async (web3, blockNumber) => {

  /**
   * Get raw block
   * @type {Object}
   */
  let rawBlock = await Promise.promisify(web3.eth.getBlock)(blockNumber, true).timeout(10000);

  let logs = await new Promise((res, rej) =>
    web3.eth.filter({fromBlock: blockNumber, toBlock: blockNumber})
      .get((err, result) => err ? rej(err) : res(result))
  ).timeout(10000);

  rawBlock.transactions = rawBlock.transactions.map(tx => {
    tx.logs = _.chain(logs)
      .filter({transactionHash: tx.hash})
      .map(item => _.omit(item, ['transactionHash', 'transactionIndex', 'blockHash', 'blockNumber']))
      .value();
    return tx;
  });

  rawBlock.network = config.web3.network;
  return rawBlock;
};
