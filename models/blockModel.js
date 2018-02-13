/**
 * Mongoose model. Represents a block in eth
 * @module models/blockModel
 * @returns {Object} Mongoose model
 */

const mongoose = require('mongoose'),
  config = require('../config');

const Block = new mongoose.Schema({
  number: {type: Number, unique: true},
  hash: {type: String, unique: true},
  transactions: [{type: mongoose.Schema.Types.Mixed}],
  network: {type: String},
  created: {type: Date, required: true, default: Date.now}
});

Block.index({number: 1, 'transactions.to': 1, 'transactions.from': 1, 'transactions.hash': 1, 'transactions.logs.address': 1, 'transactions.logs.topics': 1});

module.exports = mongoose.model(`${config.mongo.data.collectionPrefix}Block`, Block);
