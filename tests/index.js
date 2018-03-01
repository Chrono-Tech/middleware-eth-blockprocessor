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
    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    await saveAccountForAddress(accounts[0]);
    await clearQueues(amqpInstance);
    //return await awaitLastBlock(web3);
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

    const channel = await amqpInstance.createChannel();  
    const queue = await connectToQueue(channel); 

    const hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });
 

    return await Promise.all([
      (async () => {

        return await new Promise(res  => {
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
    const channel = await amqpInstance.createChannel();  
    await connectToQueue(channel); 

    await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[1],
      to: accounts[2],
      value: 100
    });

    const queue =  await channel.assertQueue(`app_${config.rabbit.serviceName}_test.transaction`);
    expect(queue.messageCount).to.equal(0);
  });


});
