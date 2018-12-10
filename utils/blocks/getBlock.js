/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const providerService = require('../../services/providerService'),
  BigNumber = require('bignumber.js'),
  Promise = require('bluebird'),
  crypto = require('crypto'),
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

  if (rawBlock.miner)
    rawBlock.miner = rawBlock.miner.toLowerCase();


  rawBlock.transactions = await Promise.mapSeries(rawBlock.transactions, async transaction => {

    let transformedTransaction = {
      hash: transaction.hash,
      blockNumber: transaction.blockNumber,
      blockHash: transaction.blockHash,
      transactionIndex: transaction.transactionIndex,
      from: transaction.from ? transaction.from.toLowerCase() : null,
      to: transaction.to ? transaction.to.toLowerCase() : null,
      gas: transaction.gas.toString(),
      gasPrice: transaction.gasPrice.toString(),
      gasUsed: '21000',
      logs: transaction.logs,
      nonce: transaction.nonce,
      value: transaction.value
    };

    if (transaction.input !== '0x') {
      let receipt = await web3.eth.getTransactionReceipt(transaction.hash);
      transformedTransaction.gasUsed = receipt.gasUsed.toString();
    }

    return transformedTransaction;
  });


  rawBlock.totalTxFee = _.chain(rawBlock.transactions).reduce((result, tx) =>
    BigNumber(result).plus(BigNumber(tx.gasPrice).multipliedBy(tx.gasUsed)).toString(),
  '0').value().toString();

  if (!rawBlock.transactions.length)
    return rawBlock;


  let logs = await web3.eth.getPastLogs({fromBlock: blockNumber, toBlock: blockNumber});

  rawBlock.transactions = rawBlock.transactions.map(tx => {
    tx.logs = _.chain(logs)
      .filter({transactionHash: tx.hash})
      .map(item => {

        const log = _.cloneDeep(item);
        let args = log.topics;
        let nonIndexedLogs = _.chain(log.data.replace('0x', '')).chunk(64).map(chunk => chunk.join('')).value();
        let dataIndexStart;

        if (args.length && nonIndexedLogs.length) {
          dataIndexStart = args.length;
          args.push(...nonIndexedLogs);
        }

        const hash = crypto.createHash('md5').update(`${rawBlock.number}x${log.transactionIndex}x${log.logIndex}`).digest('hex');

        return {
          hash: hash,
          blockNumber: rawBlock.number,
          txIndex: log.transactionIndex,
          index: log.logIndex,
          removed: log.removed,
          signature: _.get(log, 'topics.0'),
          args: log.topics,
          dataIndexStart: dataIndexStart,
          address: log.address.toLowerCase()
        };

      })
      .value();
    return tx;
  });

  return rawBlock;
};
