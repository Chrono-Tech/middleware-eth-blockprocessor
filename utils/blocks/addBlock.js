/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  removeUnconfirmedTxs = require('../txs/removeUnconfirmedTxs'),
  crypto = require('crypto'),
  sem = require('semaphore')(3),
  config = require('../../config'),
  models = require('../../models'),
  BigNumber = require('bignumber.js'),
  log = bunyan.createLogger({name: 'core.blockProcessor.services.addBlock', level: config.logs.level});

/**
 * @function
 * @description add block to the cache
 * @param block - prepared block with full txs
 * @param removePending - remove pending transactions
 * @returns {Promise.<*>}
 */
const addBlock = async (block, removePending = false) => {

  return new Promise((res, rej) => {

    sem.take(async () => {
      try {
        await updateDbStateWithBlock(block, removePending);
        res();
      } catch (err) {
        rej({code: 1});
      }
      sem.leave();
    });

  });

};

/**
 * @function
 * @description add new block, txs and txlogs to the cache
 * @param block
 * @param removePending
 * @return {Promise<void>}
 */
const updateDbStateWithBlock = async (block, removePending) => {

  let txs = block.transactions.map(tx => ({
      _id: tx.hash,
      index: tx.transactionIndex,
      blockNumber: block.number,
      value: tx.value,
      to: tx.to,
      nonce: tx.nonce,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      from: tx.from
    })
  );

  const logs = _.chain(block.transactions)
    .map(tx => tx.logs.map(origLog => {

        const log = _.cloneDeep(origLog);
        let args = log.topics;
        let nonIndexedLogs = _.chain(log.data.replace('0x', '')).chunk(64).map(chunk => chunk.join('')).value();
        let dataIndexStart;

        if (args.length && nonIndexedLogs.length) {
          dataIndexStart = args.length;
          args.push(...nonIndexedLogs);
        }


        const txLog = new models.txLogModel({
          blockNumber: block.number,
          txIndex: log.transactionIndex,
          index: log.logIndex,
          removed: log.removed,
          signature: _.get(log, 'topics.0'),
          args: log.topics,
          dataIndexStart: dataIndexStart,
          address: log.address
        });

        txLog._id = crypto.createHash('md5').update(`${block.number}x${log.transactionIndex}x${log.logIndex}`).digest('hex');
        return txLog;
      })
    )
    .flattenDeep()
    .value();

  log.info(`inserting ${txs.length} txs`);
  if (txs.length) {
    let bulkOps = txs.map(tx => ({
      updateOne: {
        filter: {_id: tx._id},
        update: tx,
        upsert: true
      }
    }));

    await models.txModel.bulkWrite(bulkOps);
  }

  log.info(`inserting ${logs.length} logs`);
  if (logs.length) {
    let bulkOps = logs.map(log => ({
      updateOne: {
        filter: {_id: log._id},
        update: {$set: log},
        upsert: true
      }
    }));

    await models.txLogModel.bulkWrite(bulkOps);
  }

  if (removePending) {
    log.info('removing confirmed / rejected txs');
    await removeUnconfirmedTxs();
  }

  let blockToSave = {
    _id: block.hash,
    number: block.number,
    uncleAmount: block.uncles.length,
    totalTxFee: _.chain(block.transactions).reduce((result, tx) =>
        BigNumber(result).plus(BigNumber(tx.gasPrice).multipliedBy(tx.gas)).toString(),
      '0').value().toString(),
    timestamp: block.timestamp
  };

  await models.blockModel.update({_id: blockToSave._id}, blockToSave, {upsert: true});
};


module.exports = addBlock;
