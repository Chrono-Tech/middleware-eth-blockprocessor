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


const TX = new mongoose.Schema({
  _id: {type: String},
  blockNumber: {type: Number, required: true, default: -1},
  index: {type: Number},
  value: {type: mongoose.Schema.Types.Long},
  to: {type: String, index: true},
  fee: {type: mongoose.Schema.Types.Long},
  nonce: {type: Number},
  gasPrice: {type: mongoose.Schema.Types.Long},
  gas: {type: mongoose.Schema.Types.Long},
  from: {type: String, index: true}
}, {_id: false});

TX.index({blockNumber: 1, index: 1});

module.exports = () =>
  mongoose.model(`${config.mongo.data.collectionPrefix}TX`, TX);
