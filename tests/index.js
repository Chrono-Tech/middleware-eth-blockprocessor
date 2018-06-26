/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

require('dotenv/config');

const config = require('../config'),
  Promise = require('bluebird'),
  mongoose = require('mongoose'),
  models = require('../models'),
  providerService = require('../services/providerService'),
  awaitLastBlock = require('./helpers/awaitLastBlock'),
  clearMongoBlocks = require('./helpers/clearMongoBlocks'),
  saveAccountForAddress = require('./helpers/saveAccountForAddress'),
  connectToQueue = require('./helpers/connectToQueue'),
  clearQueues = require('./helpers/clearQueues'),
  consumeMessages = require('./helpers/consumeMessages'),
  consumeStompMessages = require('./helpers/consumeStompMessages'),
  WebSocket = require('ws'),
  expect = require('chai').expect,
  amqp = require('amqplib'),
  Stomp = require('webstomp-client');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

let ctx = {};

describe('core/block processor', function () {

  before(async () => {

    models.init();

    await clearMongoBlocks();
    ctx.amqpInstance = await amqp.connect(config.rabbit.url);
    ctx.web3 = await providerService.get();

    ctx.accounts = await Promise.promisify(ctx.web3.eth.getAccounts)();
    await saveAccountForAddress(ctx.accounts[0]);
    await clearQueues(ctx.amqpInstance);
    return await awaitLastBlock(ctx.web3);
  });

  after(async () => {
    await clearMongoBlocks();
    ctx.web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  afterEach(async () => {
      await clearQueues(ctx.amqpInstance);
  });

  it('send some eth from 0 account to account 1', async () => {
    const hash = await Promise.promisify(ctx.web3.eth.sendTransaction)({
      from: ctx.accounts[0],
      to: ctx.accounts[1],
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
      expect(content.from).to.equal(ctx.accounts[0]);
      expect(content.to).to.equal(ctx.accounts[1]);
      expect(content.nonce).to.be.a('number');
    };

    return await Promise.all([
      (async() => {
        await Promise.promisify(ctx.web3.eth.sendTransaction)({
          from: ctx.accounts[0],
          to: ctx.accounts[1],
          value: 100
        });
      })(),
      (async () => {
        const channel = await ctx.amqpInstance.createChannel();
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


    await Promise.promisify(ctx.web3.eth.sendTransaction)({
      from: ctx.accounts[1],
      to: ctx.accounts[2],
      value: 100
    });
    Promise.delay(1000, async() => {
      const channel = await ctx.amqpInstance.createChannel();
      const queue =await connectToQueue(channel); 
      expect(queue.messageCount).to.equal(0);
    });
  });

});
