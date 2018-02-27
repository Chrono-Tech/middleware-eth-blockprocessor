require('dotenv/config');

const config = require('../config'),
  Promise = require('bluebird'),
  mongoose = require('mongoose');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

const awaitLastBlock = require('./helpers/awaitLastBlock'),
  clearMongoBlocks = require('./helpers/clearMongoBlocks'),
  net = require('net'),
  WebSocket = require('ws'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  accountModel = require('../models/accountModel'),
  amqp = require('amqplib'),
  Stomp = require('webstomp-client'),
  ctx = {};

let accounts;

describe('core/block processor', function () {

  before(async () => {
    await clearMongoBlocks();
    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    return await awaitLastBlock(web3);
  });

  after(async () => {
    await clearMongoBlocks();
    web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  it('add account to mongo', async () => {
    try {
      await new accountModel({address: accounts[0]}).save();
    } catch (e) {}
  });

  it('send some eth from 0 account to account 1', async () => {
    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });

    expect(ctx.hash).to.be.string;
  });

  it('send some eth and validate structure', async () => {

    const checkMessage = function (content) {
      expect(content).to.have.all.keys(
        'hash',
        'nonce',
        'blockNumber',
        'from',
        'to',
        'value',
        'gas',
        'gasPrice',
        'input',
        'logs'
      );
      expect(content.value).to.equal('100');
      expect(content.from).to.equal(accounts[0]);
      expect(content.to).to.equal(accounts[1]);
      expect(content.nonce).to.be.a('number');
    };


    let amqpInstance = await amqp.connect(config.rabbit.url);
    let channel = await amqpInstance.createChannel();

    try {
      await channel.assertExchange('events', 'topic', {durable: false});
    } catch (e) {
      channel = await amqpInstance.createChannel();
    }

    return await Promise.all([
      (async () => {
        await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[0],
          to: accounts[1],
          value: 100
        });
      })(),
      (async () => {

        try {
          let queue1 = await channel.assertQueue(`app_${config.rabbit.serviceName}_test.transaction`);
          await channel.bindQueue(`app_${config.rabbit.serviceName}_test.transaction`, 'events', `${config.rabbit.serviceName}_transaction.*`);
          expect(queue1.messageCount).to.equal(2);
        } catch (e) {
          channel = await amqpInstance.createChannel();
        }

        await new Promise(res  => {
          let messageCount = 1;
          channel.consume(`app_${config.rabbit.serviceName}_test.transaction`, (message) => {
            checkMessage(JSON.parse(message.content));
            messageCount === 2 ? res() : messageCount++;
          })
        });
      })(),
      (async () => {
        let ws = new WebSocket('ws://localhost:15674/ws');
        let client = Stomp.over(ws, {heartbeat: false, debug: false});

        return await new Promise(res =>
          client.connect('guest', 'guest', async () => {
            let messageCount = 1;
            client.subscribe( `/exchange/events/${config.rabbit.serviceName}_transaction.*`, (message) => {
              checkMessage(JSON.parse(message.body));
              messageCount === 2 ? res() : messageCount++;
            })
          })
        );
      })()
    ]);
  });


  it('send some  eth from nonregistered user to non registered user and has not notifications', async () => {



    let amqpInstance = await amqp.connect(config.rabbit.url);
    let channel = await amqpInstance.createChannel();

    try {
      await channel.assertExchange('events', 'topic', {durable: false});
    } catch (e) {
      channel = await amqpInstance.createChannel();
    }

    return await Promise.all([
      (async () => {
        await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[1],
          to: accounts[2],
          value: 100
        });
      })(),
      (async () => {

        let queue1 = await channel.assertQueue(`app_${config.rabbit.serviceName}_test.transaction`);
        await channel.bindQueue(`app_${config.rabbit.serviceName}_test.transaction`, 'events', `${config.rabbit.serviceName}_transaction.*`);
        expect(queue1.messageCount).to.equal(0);
      })()
    ]);
  });



});
