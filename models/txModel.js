/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Mongoose model. Represents a block in eth
 * @module models/blockModel
 * @returns {Object} Mongoose model
 */

const mongoose = require('mongoose'),
  config = require('../config');

const TX = new mongoose.Schema({
  blockNumber: {type: Number, required: true, index: true, default: -1},
  timestamp: {type: Number, required: true, index: true, default: Date.now},
  value: {type: Number},
  transactionIndex: {type: Number},
  to: {type: String, index: true},
  nonce: {type: Number},
  input: {type: String},
  hash: {type: String, index: true, unique: true},
  gasPrice: {type: String},
  gas: {type: Number},
  from: {type: String, index: true},
  logs: [{
    removed: {type: Boolean},
    logIndex: {type: Number},
    data: {type: String},
    signature: {type: String, index: true}, //0 topic
    topics: {type: Array, default: []},
    address: {type: String, index: true}
  }],
  created: {type: Date, required: true, default: Date.now}
});

module.exports = mongoose.model(`${config.mongo.data.collectionPrefix}TX`, TX);
