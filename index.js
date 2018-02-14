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

  const provider = new Web3.providers.IpcProvider(config.web3.uri, net);
  const web3 = new Web3();
  web3.setProvider(provider);
  const blockCacheService = new BlockCacheService(web3);

  web3.currentProvider.connection.on('end', () => {
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

  blockCacheService.events.on('block', async block=>{
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

  web3.eth.filter('pending').watch(async (err, result) => {
    if (err || !await blockCacheService.isSynced())
      return;

    let tx = await Promise.promisify(web3.eth.getTransaction)(result);

    if (!_.has(tx, 'hash'))
      return;

    let receipt = Promise.promisify(web3.eth.getTransactionReceipt)(tx.hash);
    tx.logs = _.get(receipt, 'logs', []);

    const data = await filterTxsByAccountService([tx]);

    for (let filteredTx of data) {

      let addresses = _.chain([filteredTx.to, filteredTx.from])
        .union(filteredTx.logs.map(log => log.address))
        .uniq()
        .value();

      filteredTx = _.omit(filteredTx, ['blockHash', 'transactionIndex']);
      filteredTx.blockNumber = -1;
      for (let address of addresses)
        await channel.publish('events', `${config.rabbit.serviceName}_transaction.${address}`, new Buffer(JSON.stringify(filteredTx)));
    }

  });

};

module.exports = init();
