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
  providerService = require('../services/providerService'),
  addUnconfirmedTx = require('../utils/addUnconfirmedTx'),
  getBlock = require('../utils/getBlock'),
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
    let web3 = await providerService.get();

    const pendingBlock = await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);

    if (!pendingBlock)
      await txModel.remove({blockNumber: -1});

    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.lastBlockHash = null;
    this.doJob();

    this.unconfirmedTxEventCallback = result=> this.unconfirmedTxEvent(result).catch();
    providerService.events.on('unconfirmedTx', this.unconfirmedTxEventCallback);

  }

  async doJob () {
    while (this.isSyncing)
      try {
        const block = await this.processBlock();
        await addBlock(block, true);
        this.currentHeight++;
        this.lastBlockHash = block.hash;
        this.events.emit('block', block);
      } catch (err) {

        if (err instanceof Promise.TimeoutError)
          continue;

        if (_.get(err, 'code') === 0) {
          log.info(`await for next block ${this.currentHeight}`);
          await Promise.delay(10000);
          continue;
        }

        if (_.get(err, 'code') === 1) {
          const currentBlock = await blockModel.find({
            number: {$gte: 0}
          }).sort({number: -1}).limit(2);
          this.lastBlockHash = _.get(currentBlock, '1._id');
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

  async unconfirmedTxEvent (result) {

    let web3 = await providerService.get();
    let tx = await Promise.promisify(web3.eth.getTransaction)(result);

    if (!_.has(tx, 'hash'))
      return;

    tx.logs = [];

    await addUnconfirmedTx(tx);
    this.events.emit('tx', tx);

  }

  async stopSync () {
    this.isSyncing = false;
    providerService.events.removeListener('unconfirmedTx', this.unconfirmedTxEventCallback);

  }

  async processBlock () {

    let web3 = await providerService.get();
    const block = await Promise.promisify(web3.eth.getBlockNumber)().timeout(2000).catch(() => 0);

    if (block === this.currentHeight - 1)
      return Promise.reject({code: 0});

    const lastBlock = this.currentHeight === 0 ? null :
      await Promise.promisify(web3.eth.getBlock)(this.currentHeight - 1, false).timeout(60000).catch(() => null);


    if (_.get(lastBlock, 'hash') && this.lastBlockHash) {
      let savedBlock = await blockModel.count({_id: lastBlock.hash});

      if (!savedBlock)
        return Promise.reject({code: 1});
    }

    if (!lastBlock && this.lastBlockHash)
      return Promise.reject({code: 1});

    /**
     * Get raw block
     * @type {Object}
     */

    return await getBlock(this.currentHeight);

  }

}

module.exports = BlockWatchingService;
