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

const TxLog = new mongoose.Schema({
  _id: {type: String},
  blockNumber: {type: Number, required: true, default: -1},
  txIndex: {type: Number, required: true, default: Date.now},
  index: {type: Number},
  removed: {type: Boolean},
  signature: {type: String, index: true}, //0 topic
  topics: {type: Array, default: []},
  address: {type: String, index: true}
}, {_id: false});

TxLog.index({blockNumber: 1, txIndex: 1, index: 1});


module.exports = () =>
  mongoose.model(`${config.mongo.data.collectionPrefix}TxLog`, TxLog);
