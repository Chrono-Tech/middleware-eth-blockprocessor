/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  sem = require('semaphore')(config.web3.providers.length + 1),
  blockModel = require('../models/blockModel'),
  txModel = require('../models/txModel'),
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
  const txHashes = block.transactions.map(tx => tx.hash);
  await txModel.remove({
    $or: [
      {hash: {$in: txHashes}},
      {blockNumber: -1, hash: {$nin: _.get(pendingBlock, 'transactions', [])}}
    ]
  });

  await txModel.insertMany(block.transactions);
  block.txs = txHashes;
  await blockModel.update({number: block.number}, block, {upsert: true});

};

const rollbackStateFromBlock = async (block) => {

  await txModel.remove({blockNumber: {$gte: block.number - config.consensus.lastBlocksValidateAmount}});
  await blockModel.remove({
    number: {$gte: block.number - config.consensus.lastBlocksValidateAmount}
  });
};

module.exports = addBlock;
