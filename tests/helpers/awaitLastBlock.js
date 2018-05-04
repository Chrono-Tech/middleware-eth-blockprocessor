/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const blockModel = require('../../models/blockModel'),
  config = require('../../config'),
  _ = require('lodash'),
  Promise = require('bluebird');

module.exports = (web3) =>
  new Promise(res => {
    let check = async () => {
      let latestBlock = await Promise.promisify(web3.eth.getBlockNumber)();
      await Promise.delay(10000);
      let currentBlock = await blockModel.find({}).sort('-number').limit(1);
      _.get(currentBlock, '0.number', 0) > latestBlock - 10 ?
        res() : check();
    };
    check();
  });
