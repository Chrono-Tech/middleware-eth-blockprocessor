/**
 * Mongoose model. Represents a block in eth
 * @module models/blockModel
 * @returns {Object} Mongoose model
 */

const mongoose = require('mongoose'),
  config = require('../config');

const Block = new mongoose.Schema({
  number: {type: Number, unique: true, index: true},
  hash: {type: String, unique: true, index: true},
  timestamp: {type: Number, required: true, index: true},
  transactions: [{
    value: {type: String},
    transactionIndex: {type: Number},
    to: {type: String, index: true},
    nonce: {type: Number},
    input: {type: String},
    hash: {type: String, index: true},
    gasPrice: {type: String},
    gas: {type: Number},
    from: {type: String, index: true},
    logs: [{
      removed: {type: Boolean},
      logIndex: {type: Number},
      data: {type: String},
      topics: {type: Array, index: true, default: []},
      address: {type: String, index: true}
    }]
  }],
  network: {type: String},
  created: {type: Date, required: true, default: Date.now}
});

module.exports = mongoose.model(`${config.mongo.data.collectionPrefix}Block`, Block);
