/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  txModel = require('../models/txModel'),
  log = bunyan.createLogger({name: 'app.utils.addUnconfirmedTx'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param tx - transaction
 * @returns {Promise.<*>}
 */

module.exports = async (tx) => {

  tx = {
    _id: tx.hash,
    blockNumber: -1,
    index: tx.transactionIndex,
    value: tx.value.toString(),
    to: tx.to,
    nonce: tx.nonce,
    input: tx.input,
    gasPrice: tx.gasPrice.toString(),
    gas: tx.gas,
    from: tx.from
  };

  log.info(`inserting unconfirmed tx ${tx._id}`);
  await txModel.create(tx);

};
