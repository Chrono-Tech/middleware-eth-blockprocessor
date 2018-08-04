/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const mongoose = require('mongoose'),
  config = require('../config'),
  messages = require('middleware-common-components/factories/messages/addressMessageFactory');

/** @model accountModel
 *  @description account model - represents an bitcoin account
 */
const Account = new mongoose.Schema({
  address: {
    type: String,
    unique: true,
    required: true,
    validate: [a=>  /^(0x)?[0-9a-fA-F]{40}$/.test(a), messages.wrongAddress]
  },
  balance: {type: String, default: '0'},
  isActive: {type: Boolean, required: true, default: true},
  created: {type: Date, required: true, default: Date.now},
  erc20token : {type: mongoose.Schema.Types.Mixed, default: {}}
});

module.exports = ()=>
  mongoose.accounts.model(`${config.mongo.accounts.collectionPrefix}Account`, Account);
