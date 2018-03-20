require('dotenv/config');

const config = require('../config'),
  Promise = require('bluebird'),
  mongoose = require('mongoose'),
  { spawn } = require('child_process');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

const Web3Service = require('../services/Web3Service'),
  BlockCacheService = require('../services/blockCacheService'),
  net = require('net'),
  WebSocket = require('ws'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  amqp = require('amqplib'),
  Stomp = require('webstomp-client');

let amqpInstance, ipc;

describe('core/block processor - switch providers', function () {

    beforeEach(async () => {
        ipc = spawn(
            'node',
            [__dirname + '/../ipcConverter.js'],
            {'env': {'PORT': '8546'}}
        );
        await Promise.delay(5000);
    });

    afterEach(async () => {
        if (ipc)
            ipc.kill();
    });


  it('two providers -- 8546 and 8545, after kill one switch to second', async () => {

    const newUri = 'http://localhost:8546';
    const providers = [newUri, 'http://google.ru', config.dev.web3.httpUri];

    const web3Service = new Web3Service(providers);
    web3Service.events.on('end', () => {
      log.error('ipc process has finished!');
      process.exit(0);
    });

    const blockNumber = await web3Service.getBlockNumber();
    expect(blockNumber).to.be.not.undefined;

    ipc.kill();
    await Promise.delay(3000);

    const blockNumberTwo = await web3Service.getBlockNumber();
    expect(blockNumber).to.be.not.undefined;

  });

  it('one provider -- 8546, kill him and end with errorEnd', async () => {

    const newUri = 'http://localhost:8546';
    const providers = [newUri, 'http://google.ru'];

    const web3Service = new Web3Service(providers);
    await Promise.delay(3000);
    await Promise.all([
        (async() => {
            await new Promise(res  => {
                web3Service.events.on('end', () => {
                    res();
                });
            });
        })(),
        (async() => {
            ipc.kill();
            await Promise.delay(3000);
            web3Service.getBlockNumber();
        })()
    ]);



  });

  it('two providers -- 8546 and 8545, after kill switch to second. than run first, and switch to first', async () => {

    const newUri = 'http://localhost:8546';
    const providers = [newUri, 'http://google.ru', config.dev.web3.httpUri];

    const web3Service = new Web3Service(providers);
    web3Service.events.on('end', () => {
      log.error('ipc process has finished!');
      process.exit(0);
    });

    await Promise.all([
        (async() => {
            await new Promise(res  => {
                let count = 0;
                web3Service.events.on('provider_change', () => {
                    count++;
                    if (count == 2)
                        res();
                });
            });
        })(),
        (async() => {
            await Promise.delay(2000);
            ipc.kill();
            await Promise.delay(3000);
            web3Service.getBlockNumber();

            ipc = spawn(
                'node',
                [__dirname + '/../ipcConverter.js'],
                {'env': {'PORT': '8546'}}
            );
            await Promise.delay(5000);
            web3Service.getBlockNumber();
        })()
    ]);

  });


});
