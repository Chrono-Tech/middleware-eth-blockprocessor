/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  rollbackBlock = require('../utils/blocks/rollbackBlock'),
  EventEmitter = require('events'),
  blockWatchingInterface = require('middleware-common-components/interfaces/blockProcessor/blockWatchingServiceInterface'),
  addBlock = require('../utils/blocks/addBlock'),
  models = require('../models'),
  providerService = require('../services/providerService'),
  addUnconfirmedTx = require('../utils/txs/addUnconfirmedTx'),
  removeUnconfirmedTxs = require('../utils/txs/removeUnconfirmedTxs'),
  getBlock = require('../utils/blocks/getBlock'),
  log = bunyan.createLogger({name: 'core.blockProcessor.services.blockCacheService', level: config.logs.level});

/**
 * @service
 * @description the service is watching for the recent blocks and transactions (including unconfirmed)
 * @param currentHeight - the current blockchain's height
 * @returns Object<BlockWatchingService>
 */

class BlockWatchingService {

  constructor (currentHeight) {
    this.events = new EventEmitter();
    this.currentHeight = currentHeight;
    this.isSyncing = false;
  }

  /**function
   * @description start sync process
   * @return {Promise<void>}
   */
  async startSync () {
    if (this.isSyncing)
      return;

    this.isSyncing = true;
    let web3 = await providerService.get();

    const pendingBlock = await web3.eth.getBlock('pending');

    if (!pendingBlock)
      await removeUnconfirmedTxs();

    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.doJob();

    this.unconfirmedTxEventCallback = result=> this.unconfirmedTxEvent(result).catch();
    providerService.events.on('unconfirmedTx', this.unconfirmedTxEventCallback);

  }

  /**
   * @function
   * start block watching
   * @return {Promise<void>}
   */
  async doJob () {
    while (this.isSyncing)
      try {
        const block = await this.processBlock();
        await addBlock(block, true);
        this.currentHeight++;
        this.events.emit('block', block);
      } catch (err) {

        if (_.get(err, 'code') === 0) {
          log.info(`await for next block ${this.currentHeight}`);
          await Promise.delay(10000);
          continue;
        }

        if (_.get(err, 'code') === 1) {
          await rollbackBlock(this.currentHeight);
          const currentBlock = await models.blockModel.findOne({number: {$gte: 0}}).sort({number: -1}).select('number');
          this.currentHeight = _.get(currentBlock, 'number', 0);
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

  /**
   * @function
   * @description process unconfirmed tx
   * @param hash - the hash of transaction
   * @return {Promise<void>}
   */
  async unconfirmedTxEvent (hash) {

    let web3 = await providerService.get();
    let tx = await web3.eth.getTransaction(hash);

    if (!_.has(tx, 'hash'))
      return;

    tx.logs = [];

    await addUnconfirmedTx(tx);
    this.events.emit('tx', tx);

  }

  /**
   * @function
   * @description stop the sync process
   * @return {Promise<void>}
   */
  async stopSync () {
    this.isSyncing = false;
    providerService.events.removeListener('unconfirmedTx', this.unconfirmedTxEventCallback);

  }

  /**
   * @function
   * @description process the next block from the current height
   * @return {Promise<*>}
   */
  async processBlock () {

    let web3 = await providerService.get();
    const block = await web3.eth.getBlockNumber().catch(() => 0);

    if (block === this.currentHeight - 1)
      return Promise.reject({code: 0});

    const lastBlock = this.currentHeight === 0 ? null :
      await web3.eth.getBlock(this.currentHeight - 1, false);


    if (_.get(lastBlock, 'hash')) {
      let savedBlock = await models.blockModel.count({_id: lastBlock.hash});

      if (!savedBlock)
        return Promise.reject({code: 1});
    }

    return await getBlock(this.currentHeight);
  }

}

module.exports = function (...args) {
  return blockWatchingInterface(new BlockWatchingService(...args));
};
