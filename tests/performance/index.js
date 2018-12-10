/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const config = require('../../config'),
  models = require('../../models'),
  spawn = require('child_process').spawn,
  expect = require('chai').expect,
  Promise = require('bluebird'),
  SyncCacheService = require('../../services/syncCacheService'),
  BlockWatchingService = require('../../services/blockWatchingService');

module.exports = (ctx) => {

  before(async () => {
    await models.blockModel.remove({});
    await models.txModel.remove({});
    await models.txLogModel.remove({});
    await models.accountModel.remove({});
  });


  it('validate sync cache service performance', async () => {

    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const addBlocksCount = 100 - blockNumber;

    if (addBlocksCount > 0)
      for (let i = 0; i < addBlocksCount; i++)
        await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});


    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    const syncCacheService = new SyncCacheService();
    await syncCacheService.start();
    await Promise.delay(10000);
    global.gc();
    await Promise.delay(5000);

    const memUsage2 = process.memoryUsage().heapUsed / 1024 / 1024;
    expect(memUsage2 - memUsage).to.be.below(3);
  });


  it('validate block watching service performance', async () => {

    const blockNumber = await ctx.web3.eth.getBlockNumber();

    for (let i = 0; i < 100; i++)
      await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    const blockWatchingService = new BlockWatchingService(blockNumber);
    await blockWatchingService.startSync();
    await Promise.delay(10000);
    await blockWatchingService.stopSync();
    global.gc();
    await Promise.delay(5000);

    const memUsage2 = process.memoryUsage().heapUsed / 1024 / 1024;
    expect(memUsage2 - memUsage).to.be.below(3);
  });

  it('validate tx notification speed', async () => {

    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(10000);
    await new models.accountModel({address: ctx.accounts[0]}).save();

    let tx;
    let start;
    let end;

    await Promise.all([
      (async () => {
        await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`, {autoDelete: true});
        await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`, 'events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[0]}`);
        await new Promise(res =>
          ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_performance.transaction`, async data => {

            if (!data || !tx)
              return;

            const message = JSON.parse(data.content.toString());

            if (message.hash !== tx.transactionHash)
              return;

            end = Date.now();
            await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_performance.transaction`);
            res();

          }, {noAck: true})
        );
      })(),
      (async () => {
        await Promise.delay(10000);
        tx = await ctx.web3.eth.sendTransaction({
          from: ctx.accounts[0],
          to: ctx.accounts[1],
          value: 1000
        });

        start = Date.now();
      })()
    ]);

    expect(end - start).to.be.below(10000);
    ctx.blockProcessorPid.kill();
  });

  it('unconfirmed txs performance', async () => {

    let txCount = await models.txModel.count();
    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const blockWatchingService = new BlockWatchingService(blockNumber);

    let txs = await Promise.mapSeries(new Array(100), async () => {
      return await ctx.web3.eth.sendTransaction({
        from: ctx.accounts[0],
        to: ctx.accounts[1],
        value: 1000
      });
    });

    await Promise.delay(5000);
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    await Promise.mapSeries(txs, async tx=> await blockWatchingService.unconfirmedTxEvent(tx));
    global.gc();
    await Promise.delay(5000);


    let newTxCount = await models.txModel.count();
    expect(newTxCount).to.eq(txCount + txs.length);
    const memUsage2 = process.memoryUsage().heapUsed / 1024 / 1024;
    expect(memUsage2 - memUsage).to.be.below(3);
  });

};
