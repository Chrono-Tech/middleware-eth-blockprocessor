const config = require('../config'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  blockModel = require('../models/blockModel'),
  log = bunyan.createLogger({name: 'app.services.blockCacheService'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

class BlockCacheService {

  /**
   * Creates an instance of BlockCacheService.
   * @param {Web3Service} web3Service 
   * @param {MasterNode} masterNode
   * 
   * @memberOf BlockCacheService
  
   * 
   */
  constructor (web3Service, masterNode) {
    this.web3Service = web3Service;
    this.events = new EventEmitter();

    this.masterNode = masterNode;
    this.currentHeight = 0;
    this.lastBlocks = [];
    this.isSyncing = false;
    this.pendingTxCallback = (err, tx) => this.UnconfirmedTxEvent(err, tx);
  }

  async startSync () {
    if (this.isSyncing)
      return;

    await this.indexCollection();
    this.isSyncing = true;

    const pendingBlock = await this.web3Service.getBlockPending();
    if (!pendingBlock && this.masterNode.isSyncMaster())
      await blockModel.remove({number: -1});

    this.reinitCurrentHeight();
    log.info(`caching from block:${this.currentHeight} for network:${this.web3Service.getNetwork()}`);
    
    await this.doJob();

    this.web3Service.startWatching();
    this.web3Service.events.on('pending', this.pendingTxCallback);
  }

  async reinitCurrentHeight () {
    const currentBlocks = await blockModel.find({network: this.web3Service.getNetwork()}).sort('-number').limit(config.consensus.lastBlocksValidateAmount);
    this.currentHeight = _.chain(currentBlocks).get('0.number', -1).value();
    this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).compact().reverse().value();
 
  }

  async doJob () {
    while (this.isSyncing) {

      if (!this.masterNode.isSyncMaster()) {
        this.reinitCurrentHeight();
        await Promise.delay(10000);
        continue;
      }


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

        if (err instanceof Promise.TimeoutError)
          continue;

        if (_.has(err, 'cause') && this.web3Service.isInvalidConnectionError(err))
          return process.exit(-1);

        if (_.get(err, 'code') === 0) {
          log.info(`await for next block ${this.currentHeight + 1}`);
          await Promise.delay(10000);
        }

        if (_.get(err, 'code') === 1) {
          let lastCheckpointBlock = await blockModel.findOne({hash: this.lastBlocks[0]});
          log.info(`wrong sync state!, rollback to ${lastCheckpointBlock.number - 1} block`);
          await blockModel.remove({hash: {$in: this.lastBlocks}});
          const currentBlocks = await blockModel.find({network: this.web3Service.getNetwork()}).sort('-number').limit(config.consensus.lastBlocksValidateAmount);
          this.lastBlocks = _.chain(currentBlocks).map(block => block.hash).reverse().value();
          this.currentHeight = lastCheckpointBlock - 1;
        }
      }
    }
    
  }

  async UnconfirmedTxEvent (err, txHash) {
    if (!this.masterNode.isSyncMaster())
      return;

    if (err)
      return;

    const block = await this.web3Service.getBlockPending(true);
    let currentUnconfirmedBlock = await blockModel.findOne({number: -1}) || new blockModel({
      number: -1,
      hash: null,
      timestamp: 0,
      txs: []
    });

    _.merge(currentUnconfirmedBlock, {transactions: _.get(block, 'transactions', [])});
    await blockModel.findOneAndUpdate({number: -1}, _.omit(currentUnconfirmedBlock.toObject(), ['_id', '__v']),
      {upsert: true})
      .catch(log.error);
    this.events.emit('pending', txHash);
  }

  async stopSync () {
    this.isSyncing = false;
    this.web3Service.stopWatching();
  }

  async processBlock () {

    let block = await this.web3Service.getBlockNumber();

    if (block === this.currentHeight) //heads are equal
      return Promise.reject({code: 0});

    if (block === 0) {
      let syncState = await this.web3Service.getSyncing();
      if (syncState.currentBlock !== 0)
        return Promise.reject({code: 0});
    }

    if (block < this.currentHeight)
      return Promise.reject({code: 1}); //head has been blown off

    const lastBlockHashes = await Promise.mapSeries(this.lastBlocks, 
      async blockHash => await this.web3Service.getBlock(blockHash, false));

    if (_.compact(lastBlockHashes).length !== this.lastBlocks.length)
      return Promise.reject({code: 1}); //head has been blown off

    /**
     * Get raw block
     * @type {Object}
     */
    let rawBlock = await this.web3Service.getBlock(this.currentHeight + 1, true);

    let txsReceipts = await this.web3Service.getTransactionReceipts(rawBlock.transactions);

    rawBlock.transactions = rawBlock.transactions.map(tx => {
      tx.logs = _.chain(txsReceipts)
        .find({transactionHash: tx.hash})
        .get('logs', [])
        .value();
      return tx;
    });

    rawBlock.network = this.web3Service.getNetwork();
    return rawBlock;
  }

  async indexCollection () {
    log.info('indexing...');
    await blockModel.init();
    log.info('indexation completed!');
  }

  async isSynced () {
    const height = await this.web3Service.getBlockNumber();
    return this.currentHeight >= height - config.consensus.lastBlocksValidateAmount;
  }

}

module.exports = BlockCacheService;
