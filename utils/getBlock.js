const config = require('../config'),
  Promise = require('bluebird'),
  _ = require('lodash');

module.exports = async (web3, blockNumber) => {

  /**
   * Get raw block
   * @type {Object}
   */
  let rawBlock = await Promise.promisify(web3.eth.getBlock)(blockNumber, true).timeout(1000);

  let logs = await new Promise((res, rej) =>
    web3.eth.filter({fromBlock: blockNumber, toBlock: blockNumber})
      .get((err, result) => err ? rej(err) : res(result))
  ).timeout(1000);

  rawBlock.transactions = rawBlock.transactions.map(tx => {
    tx.timestamp = rawBlock.timestamp;
    tx.logs = _.chain(logs)
      .filter({transactionHash: tx.hash})
      .map(item => {
        item = _.omit(item, ['transactionHash', 'transactionIndex', 'blockHash', 'blockNumber']);
        if (item.topics.length)
          item.signature = item.topics[0];
        return item;
      })
      .value();
    return tx;
  });

  rawBlock.network = config.web3.network;
  return rawBlock;
};
