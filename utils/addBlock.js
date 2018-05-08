/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  sem = require('semaphore')(config.web3.providers.length + 1),
  blockModel = require('../models').models.blockModel,
  txModel = require('../models').models.txModel,
  txLogsModel = require('../models').models.txLogsModel,
  log = bunyan.createLogger({name: 'app.services.addBlock'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

const addBlock = async (block, pendingBlock, type) => {

  return new Promise((res, rej) => {

    sem.take(async () => {
      try {

        await updateDbStateWithBlock(block, pendingBlock);
        res();
      } catch (err) {
        if (type === 1 && [1, 11000].includes(_.get(err, 'code'))) {
          let lastCheckpointBlock = await blockModel.findOne({
            number: {
              $lte: block.number - 1,
              $gte: block.number - 1 + config.consensus.lastBlocksValidateAmount
            }
          }).sort({number: -1});
          log.info(`wrong sync state!, rollback to ${lastCheckpointBlock.number - 1} block`);
          await rollbackStateFromBlock(lastCheckpointBlock);
        }

        rej(err);

      }

      sem.leave();
    });

  });

};

const updateDbStateWithBlock = async (block, pendingBlock) => {

  const txHashes = _.chain(block.transactions)
    .map(tx => tx.hash)
    .value();

  const pendingTxHashes = _.get(pendingBlock, 'transactions', []);

  if (pendingTxHashes.length)
    await txModel.destroyAll({blockNumber: -1, hash: {nin: pendingTxHashes}});

  const transactions = block.transactions.map(tx => ({
    blockNumber: tx.blockNumber,
    timestamp: tx.timestamp,
    value: tx.value,
    transactionIndex: tx.transactionIndex,
    to: tx.to,
    nonce: tx.nonce,
    hash: tx.hash,
    gasPrice: tx.gasPrice,
    gas: tx.gas,
    from: tx.from,
    created: tx.created,
    blockId: block.number
  }));

  if (txHashes.length)
    await txModel.destroyAll({hash: {inq: txHashes}});

  const savedTxs = await txModel.create(transactions);
  const logs = _.chain(block.transactions).map((tx, index) =>
    tx.logs.map(log => savedTxs[index].txlogs.build({
      txHash: tx.hash,
      signature: log.topics[0],
      address: log.address,
      topics: log.topics,
      data: log.data,
      logIndex: log.logIndex
    }))
  )
    .flattenDeep()
    .value();

  await txLogsModel.destroyAll({txHash: {inq: txHashes}});
  await txLogsModel.create(logs);

  block = _.pick(block, ['number', 'hash', 'timestamp', 'created']);
  block.id = block.number;
  await blockModel.create(block);

};

const rollbackStateFromBlock = async (block) => {

  await txModel.destroyAll({blockNumber: {$gte: block.number - config.consensus.lastBlocksValidateAmount}});
  await blockModel.destroyAll({
    number: {$gte: block.number - config.consensus.lastBlocksValidateAmount}
  });
};

module.exports = addBlock;
