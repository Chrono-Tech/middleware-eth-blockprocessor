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
  addUnconfirmedTx = require('../utils/addUnconfirmedTx'),
  getBlock = require('../utils/getBlock'),
  web3ProvidersService = require('./web3ProvidersService'),
  log = bunyan.createLogger({name: 'app.services.blockCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class BlockWatchingService {

  constructor (currentHeight) {
    this.events = new EventEmitter();
    this.currentHeight = currentHeight;
    this.isSyncing = false;

  }

  async startSync () {
    if (this.isSyncing)
      return;

    this.isSyncing = true;
    this.web3s = await web3ProvidersService();

    const pendingBlock = await Promise.any(this.web3s.map(async (web3) => {
      return await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);
    }));

    if (!pendingBlock)
      await txModel.remove({blockNumber: -1});

    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.lastBlockHash = null;
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
        const block = await this.processBlock();
        await addBlock(block, true);
        this.currentHeight++;
        this.lastBlockHash = block._id;
        this.events.emit('block', block);
      } catch (err) {

        if (err instanceof Promise.TimeoutError)
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

        if (_.get(err, 'code') === 1) {
          console.log(err)
          const currentBlock = await blockModel.find({
            number: {$gte: 0}
          }).sort({number: -1}).limit(2);
          this.lastBlockHash = _.get(currentBlock, '1.hash');
          this.currentHeight = _.get(currentBlock, '0.number', 0);

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

    await addUnconfirmedTx(tx).catch((e) => log.error(e));
    this.events.emit('tx', tx);

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

    const lastBlock = this.currentHeight === 0 ? null : await Promise.any(this.web3s.map(async (web3) =>
      await Promise.promisify(web3.eth.getBlock)(this.currentHeight - 1, false).timeout(60000).catch(() => null)
    ));

    if (!lastBlock && this.currentHeight > 0)
      return Promise.reject({code: 1}); //head has been blown off

    let savedBlock = await blockModel.count({_id: lastBlock.hash});

    if (!savedBlock)
      return Promise.reject({code: 1}); //head has been blown off

    /**
     * Get raw block
     * @type {Object}
     */

    return await Promise.any(this.web3s.map(async (web3) =>
      await getBlock(web3, this.currentHeight)
    ));
  }

}

module.exports = BlockWatchingService;
