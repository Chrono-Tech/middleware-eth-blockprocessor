/**
 * Middleware service for handling emitted events on chronobank platform
 * @module Chronobank/eth-blockprocessor
 */

const mongoose = require('mongoose'),
  config = require('./config'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});

const _ = require('lodash'),
  BlockCacheService = require('./services/newBlockService'),
  syncCacheService = require('./services/syncCacheService'),
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

    web3.currentProvider.connection.on('end', async () => {
      //log.error(`node connection has finished on address: ${providerURI}`);
      await Promise.delay(5000);
      web3.reset();
    });

    web3.currentProvider.connection.on('error', async () => {
      //log.error(`error - node connection has finished on address: ${providerURI}`);
      await Promise.delay(5000);
      web3.reset();
    });

    return web3;
  });

  await syncCacheService(web3s);
  process.exit(0);

  const blockCacheService = new BlockCacheService(web3s);

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

  blockCacheService.events.on('block', async block => {
    log.info('%s (%d) added to cache.', block.hash, block.number);
    const filteredTxs = await filterTxsByAccountService(block.transactions);

    for (let tx of filteredTxs) {
      let addresses = _.chain([tx.to, tx.from])
        .union(tx.logs.map(log => log.address))
        .uniq()
        .value();

      for (let address of addresses)
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(tx)));
    }
  });

  await blockCacheService.startSync();

  /*
   web3.eth.filter('pending').watch(async (err, result) => {

   if (err || !await blockCacheService.isSynced())
   return;

   let tx = await Promise.promisify(web3.eth.getTransaction)(result);

   tx.logs = [];
   if (!_.has(tx, 'hash'))
   return;

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

   });
   */

};

module.exports = init();
