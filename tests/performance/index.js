/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../../config'),
  models = require('../../models'),
  spawn = require('child_process').spawn,
  memwatch = require('memwatch-next'),
  expect = require('chai').expect,
  Promise = require('bluebird'),
  SyncCacheService = require('../../services/syncCacheService'),
  BlockWatchingService = require('../../services/blockWatchingService'),
  _ = require('lodash');

module.exports = (ctx) => {

  before(async () => {
    await models.blockModel.remove({});
    await models.txModel.remove({});
    await models.txLogModel.remove({});
    await models.accountModel.remove({});
  });



  it('validate sync cache service performance', async () => {

    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();
    const addBlocksCount = 100 - blockNumber;

    if (addBlocksCount > 0)
      for (let i = 0; i < addBlocksCount; i++)
        await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});


    let hd = new memwatch.HeapDiff();
    const syncCacheService = new SyncCacheService();
    await syncCacheService.start();
    await Promise.delay(10000);

    let diff = hd.end();
    let leakObjects = _.filter(diff.change.details, detail => detail.size_bytes / 1024 / 1024 > 3);

    expect(leakObjects.length).to.be.eq(0);
  });


  it('validate block watching service performance', async () => {

    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();

    for (let i = 0; i < 100; i++)
      await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    let hd = new memwatch.HeapDiff();
    const blockWatchingService = new BlockWatchingService(blockNumber);
    await blockWatchingService.startSync();
    await Promise.delay(10000);
    await blockWatchingService.stopSync();

    let diff = hd.end();
    let leakObjects = _.filter(diff.change.details, detail => detail.size_bytes / 1024 / 1024 > 3);

    expect(leakObjects.length).to.be.eq(0);
  });

  it('validate tx notification speed', async () => {

    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'inherit'});
    await Promise.delay(10000);
    await new models.accountModel({address: ctx.accounts[0]}).save();

    let tx;
    let start;
    let end;

    await Promise.all([
      (async () => {
        await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`);
        await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`, 'events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[0]}`);
        await new Promise(res =>
          ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_performance.transaction`, async data => {

            if (!data || !tx)
              return;

            const message = JSON.parse(data.content.toString());

            if (message.hash !== tx.hash)
              return;

            end = Date.now();
            await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`);
            res();

          }, {noAck: true})
        );
      })(),
      (async () => {
        await Promise.delay(10000);
        let txHash = await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1000});
        tx = await Promise.promisify(ctx.web3.eth.getTransaction)(txHash);
        start = Date.now();
      })()
    ]);

    expect(end - start).to.be.below(5000);
    ctx.blockProcessorPid.kill();
  });

  it('unconfirmed txs performance', async () => {

    let txCount = await models.txModel.count();
    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();
    const blockWatchingService = new BlockWatchingService(blockNumber);

    let txHashes = await Promise.mapSeries(new Array(100), async () => {
      return await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1000});
    });

    let hd = new memwatch.HeapDiff();

    for (let txHash of txHashes)
      blockWatchingService.unconfirmedTxEvent(txHash).catch(e => {
        throw new Error(e)
      });

    await new Promise(res => {
      let pinInterval = setInterval(async () => {
        let newTxCount = await models.txModel.count();

        if (newTxCount !== txCount + txHashes.length)
          return;

        clearInterval(pinInterval);
        res();
      }, 3000);
    });

    let diff = hd.end();
    let leakObjects = _.filter(diff.change.details, detail => detail.size_bytes / 1024 / 1024 > 3);

    expect(leakObjects.length).to.be.eq(0);

  });

};
