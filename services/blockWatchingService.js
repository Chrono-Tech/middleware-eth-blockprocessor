/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  addBlock = require('../utils/addBlock'),
  blockModel = require('../models/blockModel'),
  txModel = require('../models/txModel'),
  getBlock = require('../utils/getBlock'),
  log = bunyan.createLogger({name: 'app.services.blockCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class BlockWatchingService {

  constructor (web3s, currentHeight) {
    this.web3s = web3s;
    this.events = new EventEmitter();
    this.currentHeight = currentHeight;
    this.lastBlocks = [];
    this.isSyncing = false;
  }

  async startSync () {
    if (this.isSyncing)
      return;

    this.isSyncing = true;

    const pendingBlock = await Promise.any(this.web3s.map(async (web3) => {
      return await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);
    }));

    if (!pendingBlock)
      await txModel.remove({blockNumber: -1});

    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.lastBlocks = [];
    this.doJob();
    this.pendingFilters = this.web3s.map(web3 =>
      web3.eth.filter('pending')
    );

    this.pendingFilters.map((filter, index) =>
      filter.watch((err, result) => this.UnconfirmedTxEvent(err, result, this.web3s[index]))
    );

  }

  async doJob () {
    while (this.isSyncing)
      try {
        const data = await this.processBlock();

        await addBlock(data.block, data.unconfirmedBlock, 1);

        this.currentHeight++;
        _.pullAt(this.lastBlocks, 0);
        this.lastBlocks.push(data.block.hash);
        this.events.emit('block', data.block);
      } catch (err) {

        if (err instanceof Promise.TimeoutError && this.web3.isConnected())
          continue;

        if (err instanceof Promise.AggregateError) {
          log.error('all nodes are down or not synced!');
          process.exit(0);
        }

        if (_.get(err, 'code') === 0) {
          log.info(`await for next block ${this.currentHeight}`);
          await Promise.delay(10000);
          continue;
        }

        if ([1, 11000].includes(_.get(err, 'code'))) {
          const currentBlocks = await blockModel.find({
            timestamp: {$ne: 0}
          }).sort({number: -1}).limit(config.consensus.lastBlocksValidateAmount);
          this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).reverse().value();
          this.currentHeight = _.get(currentBlocks, '0.number', 0);
          continue;

        }

        if (_.get(err, 'code') === 2) {
          log.info(`the current provider hasn't reached the synced state, await the sync until block ${this.currentHeight}`);
          await Promise.delay(10000);
          continue;
        }

        log.error(err);

      }

  }

  async UnconfirmedTxEvent (err, result, web3) {

    if (err)
      return;

    let tx = await Promise.promisify(web3.eth.getTransaction)(result);

    if (!_.has(tx, 'hash'))
      return;

    tx.logs = [];
    try {
      await txModel.findOneAndUpdate({blockNumber: -1, hash: tx.hash}, tx, {upsert: true, setDefaultsOnInsert: true});
      this.events.emit('tx', tx);
    } catch (err) {
      if (_.get(err, 'code') === 11000)
        return;

      log.error(err);
    }
  }

  async stopSync () {
    this.isSyncing = false;
    await new Promise((res) =>
      this.pendingFilter.stopWatching(res)
    );
  }

  async processBlock () {

    const blocks = await Promise.map(this.web3s, async (web3) => {
      return await Promise.promisify(web3.eth.getBlockNumber)().timeout(10000).catch(() => 0);
    });

    const block = _.max(blocks);

    if (block === this.currentHeight - 1) //heads are equal
      return Promise.reject({code: 0});

    if (block === 0) {

      const syncStates = await Promise.map(this.web3s, async (web3) => {
        return await Promise.promisify(web3.eth.getSyncing)().timeout(60000).catch(() => null);
      });

      let syncState = _.find(syncStates, state => _.get(state, 'currentBlock') !== 0);

      if (syncState)
        return Promise.reject({code: 0});
    }

    if (block < this.currentHeight)
      return Promise.reject({code: 2}); //head has been blown off

    const lastBlockHashes = await Promise.map(this.web3s, async (web3) => {
      return await Promise.mapSeries(this.lastBlocks, async blockHash =>
        await Promise.promisify(web3.eth.getBlock)(blockHash, false).timeout(60000)
      ).catch(() => []);
    });

    const isEqualLength = _.find(lastBlockHashes, item => _.compact(item).length === this.lastBlocks.length);

    if (!isEqualLength)
      return Promise.reject({code: 1}); //head has been blown off

    /**
     * Get raw block
     * @type {Object}
     */

    return await Promise.any(this.web3s.map(async (web3) => {
      const block = await getBlock(web3, this.currentHeight);
      const unconfirmedBlock = await Promise.promisify(web3.eth.getBlock)('pending', false);
      return {block: block, unconfirmedBlock: unconfirmedBlock};
    }));

  }

}

module.exports = BlockWatchingService;
