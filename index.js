/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

/**
 * Middleware service for handling emitted events on chronobank platform
 * @module Chronobank/eth-blockprocessor
 */

const mongoose = require('mongoose'),
  config = require('./config'),
  MasterNodeService = require('./services/MasterNodeService'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});

const _ = require('lodash'),
  BlockWatchingService = require('./services/blockWatchingService'),
  SyncCacheService = require('./services/syncCacheService'),
  bunyan = require('bunyan'),
  Web3 = require('web3'),
  net = require('net'),
  amqp = require('amqplib'),
  log = bunyan.createLogger({name: 'app'}),
  filterTxsByAccountService = require('./services/filterTxsByAccountService');

[mongoose.accounts, mongoose.connection].forEach(connection =>
  connection.on('disconnected', function () {
    log.error('mongo disconnected!');
    process.exit(0);
  })
);

const init = async () => {

  const web3s = config.web3.providers.map((providerURI) => {
    const provider = /^http/.test(providerURI) ?
      new Web3.providers.HttpProvider(providerURI) :
      new Web3.providers.IpcProvider(`${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${providerURI}`, net);

    const web3 = new Web3();
    web3.setProvider(provider);

    if (_.has(web3, 'currentProvider.connection.on')) {
      web3.currentProvider.connection.on('end', async () => {
        await Promise.delay(5000);
        web3.reset();
      });

      web3.currentProvider.connection.on('error', async () => {
        await Promise.delay(5000);
        web3.reset();
      });
    }

    return web3;
  });

  let amqpInstance = await amqp.connect(config.rabbit.url)
    .catch(() => {
      log.error('rabbitmq process has finished!');
      process.exit(0);
    });

  let channel = await amqpInstance.createChannel();

  channel.on('close', () => {
    log.error('rabbitmq process has finished!');
    process.exit(0);
  });

  await channel.assertExchange('events', 'topic', {durable: false});


  const masterNodeService = new MasterNodeService(channel, (msg) => log.info(msg));
  await masterNodeService.start();

  const syncCacheService = new SyncCacheService(web3s);

  let blockEventCallback = async block => {
    log.info(`${block.hash} (${block.number}) added to cache.`);
    await channel.publish('events', `${config.rabbit.serviceName}_block`, new Buffer(JSON.stringify({block: block.number})));
    const filteredTxs = await filterTxsByAccountService(block.transactions);

    for (let tx of filteredTxs) {
      let addresses = _.chain([tx.to, tx.from])
        .union(tx.logs.map(log => log.address))
        .uniq()
        .value();

      for (let address of addresses)
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(tx)));
    }
  };
  let txEventCallback = async tx => {
    const data = await filterTxsByAccountService([tx]);
    for (let filteredTx of data) {
      let addresses = _.chain([filteredTx.to, filteredTx.from])
        .uniq()
        .value();

      filteredTx = _.omit(filteredTx, ['blockHash', 'transactionIndex']);
      filteredTx.blockNumber = -1;
      for (let address of addresses)
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(filteredTx)));
    }
  };

  syncCacheService.events.on('block', blockEventCallback);

  let endBlock = await syncCacheService.start()
    .catch((err) => {
      if (_.get(err, 'code') === 0) {
        log.info('nodes are down or not synced!');
        process.exit(0);
      }
      log.error(err);
    });

  await new Promise((res) => {
    if (config.sync.shadow)
      return res();

    syncCacheService.events.on('end', () => {
      log.info(`cached the whole blockchain up to block: ${endBlock}`);
      res();
    });
  });

  let blockWatchingService = new BlockWatchingService(web3s, endBlock);

  blockWatchingService.events.on('block', blockEventCallback);
  blockWatchingService.events.on('tx', txEventCallback);

  await blockWatchingService.startSync().catch(err => {
    if (_.get(err, 'code') === 0) {
      log.error('no connections available or blockchain is not synced!');
      process.exit(0);
    }
  });

};

module.exports = init();
