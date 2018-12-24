/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  removeUnconfirmedTxs = require('../txs/removeUnconfirmedTxs'),
  sem = require('semaphore')(3),
  config = require('../../config'),
  models = require('../../models'),
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

  const logs = _.chain(block.transactions)
    .map(tx => tx.logs)
    .flattenDeep()
    .value();

  log.info(`inserting ${block.transactions.length} txs`);
  if (block.transactions.length) {
    let bulkOps = block.transactions.map(tx => ({
      updateOne: {
        filter: {_id: tx.hash},
        update: new models.txModel(tx).toObject(),
        upsert: true
      }
    }));

    await models.txModel.bulkWrite(bulkOps);
  }

  log.info(`inserting ${logs.length} logs`);
  if (logs.length) {
    let bulkOps = logs.map(log => ({
      updateOne: {
        filter: {_id: log.hash},
        update: new models.txLogModel(log).toObject(),
        upsert: true
      }
    }));

    await models.txLogModel.bulkWrite(bulkOps);
  }

  if (removePending) {
    log.info('removing confirmed / rejected txs');
    await removeUnconfirmedTxs();
  }


  await models.blockModel.update({_id: block.hash}, new models.blockModel(block), {upsert: true});
};


module.exports = addBlock;
