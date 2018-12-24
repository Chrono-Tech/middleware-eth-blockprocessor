/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  _ = require('lodash'),
  erc20tokenABI = require('../contracts/TokenContract.json'),
  filterTxsByAccountsService = require('../../services/filterTxsByAccountService'),
  getBlock = require('../../utils/blocks/getBlock'),
  addBlock = require('../../utils/blocks/addBlock'),
  RMQBlockModel = require('middleware-common-components/models/rmq/eth/blockModel'),
  RMQTxModel = require('middleware-common-components/models/rmq/eth/txModel'),
  allocateBlockBuckets = require('../../utils/blocks/allocateBlockBuckets'),
  addUnconfirmedTx = require('../../utils/txs/addUnconfirmedTx'),
  expect = require('chai').expect,
  Promise = require('bluebird'),
  spawn = require('child_process').spawn;

module.exports = (ctx) => {


  before(async () => {
    await models.blockModel.remove({});
    await models.txModel.remove({});
    await models.txLogModel.remove({});
    await models.accountModel.remove({});

    ctx.erc20Token = new ctx.web3.eth.Contract(erc20tokenABI.abi)
  });


  it('generate some blocks', async () => {
    for (let i = 0; i < 100; i++)
      await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    ctx.erc20TokenInstance = await ctx.erc20Token.deploy({data: erc20tokenABI.bytecode}).send({
      from: ctx.accounts[0],
      gas: 4000000,
      gasPrice: '30000000000000'
    });

    let balance = await ctx.erc20TokenInstance.methods.balanceOf(ctx.accounts[0]).call();
    expect(balance).to.equal('1000000');

    await ctx.erc20TokenInstance.methods.transfer(ctx.accounts[1], 1000).send({from: ctx.accounts[0]});
  });


  it('get block', async () => {
    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const block = await getBlock(blockNumber);

    new RMQBlockModel({block: block.number});
    expect(block.number).to.equal(blockNumber);

    for (let tx of block.transactions) {
      new RMQTxModel(tx);
      for (let log of tx.logs) {
        expect(log.signature).to.eq('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
      }
    }
  });


  it('add block', async () => {

    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const block = await getBlock(blockNumber);

    const blockCopy = _.cloneDeep(block);
    await addBlock(block);

    expect(block).to.deep.equal(blockCopy);

    const isBlockExists = await models.blockModel.count({_id: block.hash});
    expect(isBlockExists).to.equal(1);
  });


  it('find missed blocks', async () => {
    const blockNumber = await ctx.web3.eth.getBlockNumber();

    ctx.blockProcessorPid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
    await Promise.delay(blockNumber * 1000 + 20000);
    ctx.blockProcessorPid.kill();

    const blockCount = await models.blockModel.count({});

    expect(blockCount).to.equal(blockNumber + 1);

    let blocks = [];

    for (let i = 0; i < blockNumber - 2; i++)
      blocks.push(i);

    blocks = _.shuffle(blocks);

    const blocksToRemove = _.take(blocks, 50);
    await models.blockModel.remove({number: {$in: blocksToRemove}});

    const buckets = await allocateBlockBuckets();
    expect(buckets.height).to.equal(blockNumber - 1);

    let blocksToFetch = [];

    for (let bucket of buckets.missedBuckets) {

      if (bucket.length === 1) {
        blocksToFetch.push(...bucket);
        continue;
      }

      for (let blockNumber = _.last(bucket); blockNumber >= bucket[0]; blockNumber--)
        blocksToFetch.push(blockNumber);
    }

    expect(_.isEqual(_.sortBy(blocksToRemove), _.sortBy(blocksToFetch))).to.equal(true);
  });


  it('add unconfirmed tx', async () => {

    await ctx.web3.eth.sendTransaction({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    const blockNumber = await ctx.web3.eth.getBlockNumber();
    const block = await getBlock(blockNumber);

    const tx = block.transactions[0];
    const txCopy = _.cloneDeep(tx);
    await addUnconfirmedTx(tx);

    expect(_.isEqual(tx, txCopy)).to.equal(true); //check that object hasn't been modified


    const isTxExists = await models.txModel.count({_id: tx.hash});
    expect(isTxExists).to.equal(1);
  });

  it('check filterTxsByAccountsService', async () => {

    await models.accountModel.create({address: ctx.accounts[0]});
    const blockNumber = await ctx.web3.eth.getBlockNumber();

    for (let i = 0; i < 2; i++) {
      let block = await getBlock(blockNumber - i);
      await addBlock(block);
    }

    const block = await getBlock(blockNumber);
    const filtered = await filterTxsByAccountsService([block.transactions[0]]);

    expect(!!_.find(filtered, {address: ctx.accounts[0]})).to.eq(true);
    expect(!!_.find(filtered, {address: ctx.accounts[1]})).to.eq(false);
  });




};
