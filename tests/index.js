require('dotenv/config');

const config = require('../config'),
  awaitLastBlock = require('./helpers/awaitLastBlock'),
  net = require('net'),
  path = require('path'),
  Web3 = require('web3'),
  web3 = new Web3(),
  mongoose = require('mongoose'),
  expect = require('chai').expect,
  SockJS = require('sockjs-client'),
  Promise = require('bluebird'),
  accountModel = require('../models/accountModel'),
  amqp = require('amqplib'),
  Stomp = require('webstomp-client'),
  ctx = {};

describe('core/block processor', function () {

  before(async () => {
    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);
    mongoose.Promise = Promise;
    mongoose.connect(config.mongo.uri, {useMongoClient: true});

    return await awaitLastBlock(web3);
  });

  after(() => {
    web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  it('add account to mongo', async () => {
    let accounts = await Promise.promisify(web3.eth.getAccounts)();
    try {
      await new accountModel({address: accounts[0]}).save();
    } catch (e) {
    }
  });

  it('send some eth from 0 account to account 1', async () => {
    let accounts = await Promise.promisify(web3.eth.getAccounts)();
    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });

    expect(ctx.hash).to.be.string;
  });


/*  it('validate tx in mongo', async () => {
    await Promise.delay(10000);
    console.log(ctx.hash);
    let result = await transactionModel.findOne({hash: ctx.hash});
    expect(result).to.include({hash: ctx.hash});
  });*/


  it('send some eth again and validate notification via amqp', async () => {

    let accounts = await Promise.promisify(web3.eth.getAccounts)();
    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });

    expect(ctx.hash).to.be.string;

    await Promise.all([
      (async () => {

        let amqpInstance = await amqp.connect(config.rabbit.url);
        let channel = await amqpInstance.createChannel();
        try {
          await channel.assertExchange('events', 'topic', {durable: false});
          await channel.assertQueue('app_eth_test.transaction');
          await channel.bindQueue('app_eth_test.transaction', 'events', 'eth_transaction.*');
        } catch (e) {
          channel = await amqpInstance.createChannel();
        }

        return await new Promise(res =>
          channel.consume('app_eth_test.transaction', res, {noAck: true})
        )

      })(),
      (async () => {
        let ws = new SockJS('http://localhost:15674/stomp');
        let client = Stomp.over(ws, {heartbeat: false, debug: false});
        return await new Promise(res =>
          client.connect('guest', 'guest', () => {
            client.subscribe('/exchange/events/eth_transaction.*', res)
          })
        );
      })()
    ]);
  });

});
