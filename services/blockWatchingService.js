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

    this.web3 = await Promise.race(this.web3s.map(async (web3) => {
      let height = await Promise.promisify(web3.eth.getBlockNumber)().timeout(10000).catch(() => 0);
      if (!height)
        await Promise.delay(5000);
      return web3
    }));

    if (!(await Promise.promisify(this.web3.eth.getBlockNumber)().timeout(1000).catch(() => 0))) {
      log.error('no connections available!');
      process.exit(0);
    }

    await this.indexCollection();
    this.isSyncing = true;

    const pendingBlock = await Promise.promisify(this.web3.eth.getBlock)('pending').timeout(10000);
    if (!pendingBlock)
      await blockModel.remove({number: -1});

    const currentBlocks = await blockModel.find({network: config.web3.network}).sort('-number').limit(config.consensus.lastBlocksValidateAmount);
    this.currentHeight = _.chain(currentBlocks).get('0.number', -1).value();
    log.info(`caching from block:${this.currentHeight} for network:${config.web3.network}`);
    this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).compact().reverse().value();
    this.doJob();
    this.pendingFilter = this.web3.eth.filter('pending');
    this.pendingFilter.watch((err, result) => this.UnconfirmedTxEvent(err, result))
  }

  async doJob () {
    while (this.isSyncing) {
      try {
        let block = await this.processBlock();
        await blockModel.findOneAndUpdate({number: block.number}, block, {upsert: true});
        await blockModel.update({number: -1}, {
          $pull: {
            transactions: {
              hash: {
                $in: block.transactions.map(tx => tx.hash)
              }
            }
          }
        });

        this.currentHeight++;
        _.pullAt(this.lastBlocks, 0);
        this.lastBlocks.push(block.hash);
        this.events.emit('block', block);
      } catch (err) {

        if (err instanceof Promise.TimeoutError && this.web3.isConnected())
          continue;

        if (_.has(err, 'cause') && err.toString() === web3Errors.InvalidConnection('on IPC').toString()) {
          await this.stopSync().catch(e => console.log(e));
          return this.events.emit('error', {code: 3});
        }

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
          this.currentHeight = lastCheckpointBlock.number - 1;
        }
      }
    }
  }

  async UnconfirmedTxEvent (err, result) {

    if (err || !(await this.isSynced()))
      return;

    let tx = await Promise.promisify(this.web3.eth.getTransaction)(result);

    if (!_.has(tx, 'hash'))
      return;

    tx.logs = [];

    const block = await Promise.promisify(this.web3.eth.getBlock)('pending', true);
    let currentUnconfirmedBlock = await blockModel.findOne({number: -1}) || new blockModel({
        number: -1,
        hash: null,
        timestamp: 0,
        txs: []
      });

    _.merge(currentUnconfirmedBlock, {transactions: _.get(block, 'transactions', [])});
    await blockModel.findOneAndUpdate({number: -1}, _.omit(currentUnconfirmedBlock.toObject(), ['_id', '__v']),
      {upsert: true})
      .catch(err => log.error(err));
    this.events.emit('tx', tx)

  }

  async stopSync () {
    this.isSyncing = false;
    await new Promise((res, rej) =>
      this.pendingFilter.stopWatching(res)
    );
  }

  async processBlock () {

    let block = await Promise.promisify(this.web3.eth.getBlockNumber)().timeout(10000);

    if (block === this.currentHeight) //heads are equal
      return Promise.reject({code: 0});

    if (block === 0) {
      let syncState = await Promise.promisify(this.web3.eth.getSyncing)().timeout(10000);
      if (syncState.currentBlock !== 0)
        return Promise.reject({code: 0});
    }

    if (block < this.currentHeight)
      return Promise.reject({code: 1}); //head has been blown off

    const lastBlockHashes = await Promise.mapSeries(this.lastBlocks, async blockHash => await Promise.promisify(this.web3.eth.getBlock)(blockHash, false).timeout(10000));

    if (_.compact(lastBlockHashes).length !== this.lastBlocks.length)
      return Promise.reject({code: 1}); //head has been blown off

    /**
     * Get raw block
     * @type {Object}
     */
    let rawBlock = await Promise.promisify(this.web3.eth.getBlock)(this.currentHeight + 1, true).timeout(10000);

    let logs = await new Promise((res, rej) =>
      this.web3.eth.filter({fromBlock: this.currentHeight + 1, toBlock: this.currentHeight + 1})
        .get((err, result) => err ? rej(err) : res(result))
    ).timeout(10000);

    rawBlock.transactions = rawBlock.transactions.map(tx => {
      tx.logs = _.chain(logs)
        .filter({transactionHash: tx.hash})
        .map(item => _.omit(item, ['transactionHash', 'transactionIndex', 'blockHash', 'blockNumber']))
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

module.exports = BlockWatchingService;
