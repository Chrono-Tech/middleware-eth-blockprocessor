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
  BlockCacheService = require('./services/blockCacheService'),
  Web3Service = require('./services/Web3Service'),
  bunyan = require('bunyan'),
  amqp = require('amqplib'),
  log = bunyan.createLogger({name: 'app'}),
  MasterNode = require('./services/MasterNode'),
  filterTxsByAccountService = require('./services/filterTxsByAccountService');

[mongoose.accounts, mongoose.connection].forEach(connection =>
  connection.on('disconnected', function () {
    log.error('mongo disconnected!');
    process.exit(0);
  })
);

const init = async () => {

  const web3Service = new Web3Service(config.web3.providers);
  web3Service.events.on('end', () => {
    log.error('ipc process has finished!');
    process.exit(0);
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

  const masterNode = new MasterNode(channel, (msg) => log.info(msg));
  await masterNode.start();

  const blockCacheService = new BlockCacheService(web3Service, masterNode);

  blockCacheService.events.on('block', async block => {
    if (!await masterNode.isSyncMaster())
      return;

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


  blockCacheService.events.on('pending', async (txHash) => {
    if (!await masterNode.isSyncMaster())
      return;
      
    let tx = await web3Service.getTransaction(txHash);

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

  blockCacheService.startSync();

};

module.exports = init();
