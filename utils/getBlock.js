/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const Promise = require('bluebird'),
  _ = require('lodash');

module.exports = async (web3, blockNumber) => {

  /**
   * Get raw block
   * @type {Object}
   */
  let rawBlock = await Promise.promisify(web3.eth.getBlock)(blockNumber, true).timeout(60000);

  let logs = await new Promise((res, rej) =>
    web3.eth.filter({fromBlock: blockNumber, toBlock: blockNumber})
      .get((err, result) => err ? rej(err) : res(result))
  ).timeout(60000);

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

  return rawBlock;
};
