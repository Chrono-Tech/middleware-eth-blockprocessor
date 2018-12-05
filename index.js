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
  RMQBlockModel = require('middleware-common-components/models/rmq/eth/blockModel'),
  RMQTxModel = require('middleware-common-components/models/rmq/eth/txModel'),
  MasterNodeService = require('middleware-common-components/services/blockProcessor/MasterNodeService'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  providerService = require('./services/providerService'),
  AmqpService = require('middleware_common_infrastructure/AmqpService'),
  InfrastructureInfo = require('middleware_common_infrastructure/InfrastructureInfo'),
  InfrastructureService = require('middleware_common_infrastructure/InfrastructureService'),
  
  BlockWatchingService = require('./services/blockWatchingService'),
  SyncCacheService = require('./services/syncCacheService'),
  bunyan = require('bunyan'),
  amqp = require('amqplib'),
  log = bunyan.createLogger({name: 'core.blockProcessor', level: config.logs.level}),
  filterTxsByAccountService = require('./services/filterTxsByAccountService');

mongoose.Promise = Promise;
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});

const runSystem = async function () {
  const rabbit = new AmqpService(
    config.systemRabbit.url, 
    config.systemRabbit.exchange,
    config.systemRabbit.serviceName
  );
  const info = new InfrastructureInfo(require('./package.json'));
  const system = new InfrastructureService(info, rabbit, {checkInterval: 10000});
  await system.start();
  system.on(system.REQUIREMENT_ERROR, (requirement, version) => {
    log.error(`Not found requirement with name ${requirement.name} version=${requirement.version}.` +
        ` Last version of this middleware=${version}`);
    process.exit(1);
  });
  await system.checkRequirements();
  system.periodicallyCheck();
};

const init = async () => {
  if (config.checkSystem)
    await runSystem();

  [mongoose.accounts, mongoose.connection].forEach(connection =>
    connection.on('disconnected', () => {
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
  await channel.assertExchange('internal', 'topic', {durable: false});
  await channel.assertQueue(`${config.rabbit.serviceName}_current_provider.get`, {durable: false, autoDelete: true});
  await channel.bindQueue(`${config.rabbit.serviceName}_current_provider.get`, 'internal', `${config.rabbit.serviceName}_current_provider.get`);


  const masterNodeService = new MasterNodeService(channel, config.rabbit.serviceName);
  await masterNodeService.start();

  providerService.on('provider_set', providerURI => {
    let providerIndex = _.findIndex(config.web3.providers, providerURI);
    if (providerIndex !== -1)
      channel.publish('internal', `${config.rabbit.serviceName}_current_provider.set`, new Buffer(JSON.stringify({index: providerIndex})));
  });

  channel.consume(`${config.rabbit.serviceName}_current_provider.get`, async () => {
    let providerInstance = await providerService.get();
    let providerIndex = _.findIndex(config.web3.providers, provider => provider.http === providerInstance.http);
    if (providerIndex !== -1)
      channel.publish('internal', `${config.rabbit.serviceName}_current_provider.set`, new Buffer(JSON.stringify({index: providerIndex})));
  }, {noAck: true});

  const syncCacheService = new SyncCacheService();

  let blockEventCallback = async block => {
    log.info(`${block.hash} (${block.number}) added to cache.`);

    const blockModel = new RMQBlockModel({block: block.number});

    await channel.publish('events', `${config.rabbit.serviceName}_block`, new Buffer(blockModel.toString()));
    const filteredTxs = await filterTxsByAccountService(block.transactions);

    for (let item of filteredTxs)
      for (let tx of item.txs) {

        const txModel = new RMQTxModel(tx);
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${item.address}`, new Buffer(txModel.toString()));
      }
  };
  let txEventCallback = async tx => {
    const filteredTxs = await filterTxsByAccountService([tx]);
    for (let item of filteredTxs)
      for (let tx of item.txs) {
        tx.blockNumber = -1;
        const txModel = new RMQTxModel(tx);
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${item.address}`, new Buffer(txModel.toString()));
      }
  };

  syncCacheService.on('block', blockEventCallback);

  let endBlock = await syncCacheService.start();

  await new Promise((res) => {
    if (config.sync.shadow)
      return res();

    syncCacheService.on('end', () => {
      log.info(`cached the whole blockchain up to block: ${endBlock}`);
      res();
    });
  });

  let blockWatchingService = new BlockWatchingService(endBlock);

  blockWatchingService.on('block', blockEventCallback);
  blockWatchingService.on('tx', txEventCallback);

  await blockWatchingService.startSync();
};


providerService.on('connection_error', err => {
  log.error(err);
  process.exit(1);
});

module.exports = init().catch(err => {
  log.error(err);
  process.exit(0);
});
