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

require('mongoose-long')(mongoose);

const Block = new mongoose.Schema({
  _id: {type: String},
  number: {type: Number, unique: true, index: true},
  timestamp: {type: Number, required: true},
  uncleAmount: {type: Number, required: true},
  totalTxFee: {type: mongoose.Schema.Types.Long, required: true},
  created: {type: Date, required: true, default: Date.now}
}, {_id: false});

module.exports = mongoose.model(`${config.mongo.data.collectionPrefix}Block`, Block);
