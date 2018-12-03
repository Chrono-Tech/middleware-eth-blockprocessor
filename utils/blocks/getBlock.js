/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const providerService = require('../../services/providerService'),
  _ = require('lodash');

/**
 * @function
 * @description get block from the node
 * @param blockNumber
 * @return {Promise<*>}
 */
module.exports = async (blockNumber) => {

  /**
   * Get raw block
   * @type {Object}
   */

  let web3 = await providerService.get();

  let rawBlock = await web3.eth.getBlock(blockNumber, true);

  if (!rawBlock)
    return Promise.reject({code: 2});

  rawBlock.uncleAmount = rawBlock.uncles.length;

  if (!rawBlock.transactions.length) {
    rawBlock.totalTxFee = '0';
    return rawBlock;
  }

  let logs = await web3.eth.getPastLogs({fromBlock: blockNumber, toBlock: blockNumber});

  rawBlock.transactions = rawBlock.transactions.map(tx => {
    tx.logs = _.chain(logs)
      .filter({transactionHash: tx.hash})
      .map(item => {
        if (item.topics.length)
          item.signature = item.topics[0];
        return item;
      })
      .value();
    return tx;
  });

  return rawBlock;
};
