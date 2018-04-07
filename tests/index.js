/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

require('dotenv/config');

const config = require('../config'),
  Promise = require('bluebird'),
  mongoose = require('mongoose');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

const awaitLastBlock = require('./helpers/awaitLastBlock'),
  clearMongoBlocks = require('./helpers/clearMongoBlocks'),
  saveAccountForAddress = require('./helpers/saveAccountForAddress'),
  connectToQueue = require('./helpers/connectToQueue'),
  clearQueues = require('./helpers/clearQueues'),
  consumeMessages = require('./helpers/consumeMessages'),
  consumeStompMessages = require('./helpers/consumeStompMessages'),
  net = require('net'),
  WebSocket = require('ws'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  amqp = require('amqplib'),
  Stomp = require('webstomp-client');

let accounts, amqpInstance;

describe('core/block processor', function () {

  before(async () => {
    await clearMongoBlocks();
    amqpInstance = await amqp.connect(config.rabbit.url);
    const web3ProviderUri = `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${config.web3.providers[0]}`;
    let provider = new Web3.providers.IpcProvider(web3ProviderUri, net);
    web3.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    await saveAccountForAddress(accounts[0]);
    await clearQueues(amqpInstance);
    return await awaitLastBlock(web3);
  });

  after(async () => {
    await clearMongoBlocks();
    web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  afterEach(async () => {
      await clearQueues(amqpInstance);
  });

  it('send some eth from 0 account to account 1', async () => {
    const hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });
    expect(hash).to.be.string;
    expect(hash).to.be.not.undefined;
  });

  it('send some eth from account0 to account1 and validate countMessages(2) and structure message', async () => {

    const checkMessage = function (content) {
      expect(content).to.contain.all.keys(
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

    return await Promise.all([
      (async() => {
        await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[0],
          to: accounts[1],
          value: 100
        });
      })(),
      (async () => {
        const channel = await amqpInstance.createChannel();  
        await connectToQueue(channel);
        return await consumeMessages(2, channel, (message) => {
          checkMessage(JSON.parse(message.content));
        });
      })(),
      (async () => {
        const ws = new WebSocket('ws://localhost:15674/ws');
        const client = Stomp.over(ws, {heartbeat: false, debug: false});
        return await consumeStompMessages(2, client, (message) => {
          checkMessage(JSON.parse(message.body));
        });
      })()
    ]);
  });


  it('send some  eth from nonregistered user to non registered user and has not notifications', async () => {


    await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[1],
      to: accounts[2],
      value: 100
    });
    Promise.delay(1000, async() => {
      const channel = await amqpInstance.createChannel();  
      const queue =await connectToQueue(channel); 
      expect(queue.messageCount).to.equal(0);
    });
  });

});
