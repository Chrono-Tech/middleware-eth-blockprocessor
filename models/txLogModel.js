/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Mongoose model. Represents a txLog (transactions's log) in eth
 * @module models/txLogModel
 * @returns {Object} Mongoose model
 */

const mongoose = require('mongoose'),
  _ = require('lodash'),
  BigNumber = require('bignumber.js'),
  config = require('../config');


/**
 * @function
 * @description setter for args. Args - are encoded topics
 * and data in bignumber format
 * @param topics - array of topics in hex format
 * @return {*}
 */
const setArgs = function (topics) {
  _.pullAt(topics, 0);
  return topics.map((topic, index) => {
    let bn = BigNumber(topic, 16);
    return {
      e: bn.e,
      c: bn.c,
      index: index
    }
  });
};

/**
 * @function
 * @description the function for decoding the args to topics (in hex format)
 * @param topics - encoded topics in bignumber format
 * @return {*}
 */
const getArgs = topics => {
  return topics.map(topic => {
    let bn = BigNumber();
    bn.s = 1;
    bn.c = topic.c;
    bn.e = topic.e;
    topic = bn.toString('16');
    while (topic.length < 64)
      topic = '0' + topic;
    return '0x' + topic;
  });
};

const TxLog = new mongoose.Schema({
  _id: {type: String},
  blockNumber: {type: Number, required: true, default: -1},
  txIndex: {type: Number, required: true},
  index: {type: Number},
  removed: {type: Boolean},
  signature: {type: String},
  args: {type: Array, default: [], set: setArgs, get: getArgs},
  dataIndexStart: {type: Number},
  address: {type: String, index: true}
}, {_id: false});

TxLog.index({blockNumber: 1, txIndex: 1, index: 1});
TxLog.index({signature: 1});
TxLog.index({'args.e': 1, 'args.c': 1, 'args.index': 1}, {sparse: true});


module.exports = () =>
  mongoose.model(`${config.mongo.data.collectionPrefix}TxLog`, TxLog);
