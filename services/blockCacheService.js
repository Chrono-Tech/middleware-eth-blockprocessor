const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  blockModel = require('../models/blockModel'),
  web3Errors = require('web3/lib/web3/errors'),
  log = bunyan.createLogger({name: 'app.services.blockCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class BlockCacheService {

  constructor (web3) {
    this.web3 = web3;
    this.events = new EventEmitter();
    this.currentHeight = 0;
    this.lastBlocks = [];
    this.isSyncing = false;
  }

  async startSync () {
    await this.indexCollection();
    this.isSyncing = true;
    const currentBlocks = await blockModel.find({network: config.web3.network}).sort('-number').limit(config.consensus.lastBlocksValidateAmount);
    this.currentHeight = _.chain(currentBlocks).get('0.number', -1).add(1).value();
    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).compact().reverse().value();
    this.doJob();
  }

  async doJob () {
    while (this.isSyncing) {
      try {
        let block = await this.processBlock();
        await blockModel.findOneAndUpdate({number: block.number}, block, {upsert: true});
        this.currentHeight++;
        _.pullAt(this.lastBlocks, 0);
        this.lastBlocks.push(block.hash);
        this.events.emit('block', block);
      } catch (err) {

        if (err instanceof Promise.TimeoutError)
          return;

        if (_.has(err, 'cause') && err.toString() === web3Errors.InvalidConnection('on IPC').toString())
          return process.exit(-1);

        if (_.get(err, 'code') === 0) {
          log.info(`await for next block ${this.currentHeight + 1}`);
          await Promise.delay(10000);
        }

        if (_.get(err, 'code') === 1) {
          let lastCheckpointBlock = await blockModel.findOne({hash: this.lastBlocks[0]});
          log.info(`wrong sync state!, rollback to ${lastCheckpointBlock.number - 1} block`);
          await blockModel.remove({hash: {$in: this.lastBlocks}});
          const currentBlocks = await blockModel.find({network: config.web3.network}).sort('-number').limit(config.consensus.lastBlocksValidateAmount);
          this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).reverse().value();
          this.currentHeight = lastCheckpointBlock - 1;
        }
      }
    }
  }

  async stopSync () {
    this.isSyncing = false;
  }

  async processBlock () {

    let block = await Promise.promisify(this.web3.eth.getBlockNumber)();

    if (block === this.currentHeight) //heads are equal
      return Promise.reject({code: 0});

    if (block === 0) {
      let syncState = await Promise.promisify(this.web3.eth.getSyncing)();
      if (syncState.currentBlock !== 0)
        return Promise.reject({code: 0});
    }

    if (block < this.currentHeight)
      return Promise.reject({code: 1}); //head has been blown off

    const lastBlockHashes = await Promise.mapSeries(this.lastBlocks, async blockHash => await Promise.promisify(this.web3.eth.getBlock)(blockHash, false));

    if (_.compact(lastBlockHashes).length !== this.lastBlocks.length)
      return Promise.reject({code: 1}); //head has been blown off

    /**
     * Get raw block
     * @type {Object}
     */
    let rawBlock = await Promise.promisify(this.web3.eth.getBlock)(this.currentHeight, true);

    let txsReceipts = await Promise.map(rawBlock.transactions, tx =>
      Promise.promisify(this.web3.eth.getTransactionReceipt)(tx.hash), {concurrency: 1});

    rawBlock.transactions = rawBlock.transactions.map(tx => {
      tx.logs = _.chain(txsReceipts)
        .find({transactionHash: tx.hash})
        .get('logs', [])
        .value();
      return tx;
    });

    rawBlock.network = config.web3.network;
    return rawBlock;
  }

  async indexCollection () {
    log.info('indexing...');
    await blockModel.init();
    log.info('indexation completed!');
  }

  async isSynced () {
    const height = await Promise.promisify(this.web3.eth.getBlockNumber)();
    return this.currentHeight >= height - config.consensus.lastBlocksValidateAmount;
  }

}

module.exports = BlockCacheService;
