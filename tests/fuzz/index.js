/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  _ = require('lodash'),
  uniqid = require('uniqid'),
  expect = require('chai').expect,
  Promise = require('bluebird'),
  spawn = require('child_process').spawn;

module.exports = (ctx) => {

  before(async () => {
    await models.blockModel.remove({});
    await models.txModel.remove({});
    await models.txLogModel.remove({});
    await models.accountModel.remove({});
    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(10000);
  });

  it('validate block processor caching ability', async () => {

    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const addBlocksCount = 100 - blockNumber;

    if (addBlocksCount > 0)
      for (let i = 0; i < addBlocksCount; i++)
        await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});


    const newBlockNumber = await ctx.web3.eth.getBlockNumber();
    await Promise.delay(newBlockNumber * 1000 + 10000);

    let blockCount = await models.blockModel.count();
    expect(blockCount).to.be.eq(newBlockNumber + 1);
  });


  it('kill and restart block processor', async () => {
    ctx.blockProcessorPid.kill();
    await Promise.delay(5000);
    const blockNumber = await ctx.web3.eth.getBlockNumber();

    for (let i = 0; i < 50; i++)
      await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(60000);
    let blockCount = await models.blockModel.count();
    expect(blockCount).to.be.eq(51 + blockNumber);
  });

  it('kill again, push wrong blocks and restart block processor', async () => {

    ctx.blockProcessorPid.kill();

    let state = {};
    state.blocks = await models.blockModel.find({});
    state.txs = await models.txModel.find({});
    state.txLogs = await models.txLogModel.find({});


    let lastBlocks = await models.blockModel.find({}).sort({number: -1}).limit(6);

    for (let block of lastBlocks) {
      await models.blockModel.remove({number: block.number});
      block = block.toObject();
      block._id = uniqid();
      await models.blockModel.create(block);

      let txs = await models.txModel.find({blockNumber: block.number});
      await models.txModel.remove({blockNumber: block.number});

      for (let tx of txs) {
        tx = tx.toObject();
        tx._id = uniqid();
        await models.txModel.create(tx);
      }

      let txLogs = await models.txLogModel.find({blockNumber: block.number});
      await models.txLogModel.remove({blockNumber: block.number});

      for (let txLog of txLogs) {
        txLog = txLog.toObject();
        txLog._id = uniqid();
        await models.txLogModel.create(txLog);
      }
    }

    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(30000);

    let newBlocks = await models.blockModel.find({});
    state.blocks = _.chain(state.blocks).sortBy('_id').map(block => _.omit(block.toObject(), ['created', '__v'])).value();
    newBlocks = _.chain(newBlocks).sortBy('_id').map(block => _.omit(block.toObject(), ['created', '__v'])).value();


    for (let number = 0; number < state.blocks.length; number++)
      expect(state.blocks[number]).to.deep.equal(newBlocks[number]);


    let newTxs = await models.txModel.find({});
    state.txs = _.chain(state.txs).sortBy('_id').map(tx => tx.toObject()).value();
    newTxs = _.chain(newTxs).sortBy('_id').map(tx => tx.toObject()).value();

    for (let number = 0; number < state.txs.length; number++)
      expect(_.isEqual(state.txs[number], newTxs[number])).to.eq(true);


    let newTxLogs = await models.txLogModel.find({});
    state.txLogs = _.chain(state.txLogs).sortBy('_id').map(log => log.toObject()).value();
    newTxLogs = _.chain(newTxLogs).sortBy('_id').map(log => log.toObject()).value();

    for (let number = 0; number < state.txLogs.length; number++)
      expect(_.isEqual(state.txLogs[number], newTxLogs[number])).to.eq(true);
  });


  after(async () => {
    ctx.blockProcessorPid.kill();
  });


};
