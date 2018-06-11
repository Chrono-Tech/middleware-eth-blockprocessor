/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  providerService = require('../services/providerService'),
  crypto = require('crypto'),
  sem = require('semaphore')(3),
  Promise = require('bluebird'),
  models = require('../models'),
  log = bunyan.createLogger({name: 'app.services.addBlock'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - the block object
 * @param removePending - remove unconfirmed txs, which has been pulled from mempool
 * @returns {Promise.<*>}
 */

const addBlock = async (block, removePending = false) => {

  return new Promise((res, rej) => {

    sem.take(async () => {
      try {
        await updateDbStateWithBlock(block, removePending);
        res();
      } catch (err) {
        log.error(err);
        await rollbackStateFromBlock(block);
        rej(err);
      }
      sem.leave();
    });

  });

};

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
    .map(tx => tx.logs.map(log => ({
        _id: crypto.createHash('md5').update(`${block.number}x${log.transactionIndex}x${log.logIndex}`).digest('hex'),
        blockNumber: block.number,
        txIndex: log.transactionIndex,
        index: log.logIndex,
        removed: log.removed,
        signature: _.get(log, 'topics.0'), //0 topic
        topics: log.topics,
        address: log.address,
      })
      )
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
    await removeOutDated();
  }

  let blockToSave = {
    _id: block.hash,
    number: block.number,
    uncleAmount: block.uncles.length,
    totalTxFee: _.chain(block.transactions).map(tx=>tx.gasPrice * tx.gas).sum().value(),
    timestamp: block.timestamp
  };

  await models.blockModel.update({_id: blockToSave._id}, blockToSave, {upsert: true});

};

const rollbackStateFromBlock = async (block) => {

  log.info('rolling back txs state');
  await models.txModel.remove({blockNumber: block.number});

  log.info('rolling back tx logs state');
  await models.txLogModel.remove({blockNumber: block.number});

  log.info('rolling back blocks state');
  await models.blockModel.remove({number: block.number});
};

const removeOutDated = async () => {

  let web3 = await providerService.get();

  const pendingBlock = await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);

  if (!_.get(pendingBlock, 'transactions', []).length)
    return;

  if (pendingBlock.transactions.length)
    await models.txModel.remove({
      _id: {
        $nin: pendingBlock.transactions
      },
      blockNumber: -1
    });

};

module.exports = addBlock;
