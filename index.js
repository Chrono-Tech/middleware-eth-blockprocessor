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
  models = require('./models'),
  MasterNodeService = require('middleware-common-components/services/blockProcessor/MasterNodeService'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  BlockWatchingService = require('./services/blockWatchingService'),
  SyncCacheService = require('./services/syncCacheService'),
  bunyan = require('bunyan'),
  amqp = require('amqplib'),
  log = bunyan.createLogger({name: 'app'}),
  filterTxsByAccountService = require('./services/filterTxsByAccountService');

mongoose.Promise = Promise;
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});


const init = async () => {

  [mongoose.accounts, mongoose.connection].forEach(connection =>
    connection.on('disconnected', ()=> {
      throw new Error('mongo disconnected!');
    })
  );

  models.init();

  let amqpInstance = await amqp.connect(config.rabbit.url);

  let channel = await amqpInstance.createChannel();

  channel.on('close', () => {
    throw new Error('rabbitmq process has finished!');
  });

  await channel.assertExchange('events', 'topic', {durable: false});

  const masterNodeService = new MasterNodeService(channel, config.rabbit.serviceName);
  await masterNodeService.start();

  const syncCacheService = new SyncCacheService();

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

  let endBlock = await syncCacheService.start();

  await new Promise((res) => {
    if (config.sync.shadow)
      return res();

    syncCacheService.events.on('end', () => {
      log.info(`cached the whole blockchain up to block: ${endBlock}`);
      res();
    });
  });

  let blockWatchingService = new BlockWatchingService(endBlock);

  blockWatchingService.events.on('block', blockEventCallback);
  blockWatchingService.events.on('tx', txEventCallback);

  await blockWatchingService.startSync();
};

module.exports = init().catch(err => {
  log.error(err);
  process.exit(0);
});
