/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Mongoose model. Accounts
 * @module models/accountModel
 * @returns {Object} Mongoose model
 * @requires factories/addressMessageFactory
 */

const config = require('../config');

module.exports = (ds) => {
  return ds.accounts.define(`${config.storage.accounts.collectionPrefix}Account`, {
    address: {type: String, unique: true, required: true},
    balance: {type: Number, default: 0},
    isActive: {type: Boolean, required: true, default: true},
    created: {type: Date, required: true, default: Date.now},
    erc20token: {type: Object, default: {}}
  });

};