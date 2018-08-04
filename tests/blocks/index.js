/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const models = require('../../models'),
  _ = require('lodash'),
  contract = require('truffle-contract'),
  erc20token = require('../contracts/TokenContract.json'),
  erc20contract = contract(erc20token),
  filterTxsByAccountsService = require('../../services/filterTxsByAccountService'),
  getBlock = require('../../utils/blocks/getBlock'),
  addBlock = require('../../utils/blocks/addBlock'),
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
  });


  it('generate some blocks', async () => {
    for (let i = 0; i < 100; i++)
      await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});


    erc20contract.setProvider(ctx.web3.currentProvider);
    ctx.erc20TokenInstance = await erc20contract.new({from: ctx.accounts[0], gas: 1000000});
    let balance = await ctx.erc20TokenInstance.balanceOf.call(ctx.accounts[0]);
    expect(balance.toNumber()).to.equal(1000000);

    await ctx.erc20TokenInstance.transfer(ctx.accounts[1], 1000, {from: ctx.accounts[0]});
  });


  it('get block', async () => {
    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();
    const block = await getBlock(blockNumber);

    expect(block).to.have.keys('difficulty', 'extraData', 'gasLimit', 'gasUsed',
      'hash', 'logsBloom', 'miner', 'mixHash', 'nonce', 'number', 'parentHash',
      'receiptsRoot', 'sha3Uncles', 'size', 'stateRoot', 'totalDifficulty', 'transactions', 'transactionsRoot', 'uncleAmount', 'uncles', 'timestamp');

    expect(block.number).to.equal(blockNumber);

    for (let tx of block.transactions) {
      expect(tx).to.have.keys('hash', 'blockHash', 'blockNumber', 'from', 'to', 'gas', 'gasPrice', 'input', 'logs', 'nonce', 'transactionIndex', 'value');
      for (let log of tx.logs) {
        expect(log).to.have.keys('logIndex', 'transactionIndex', 'transactionHash', 'blockHash', 'blockNumber', 'address', 'data', 'topics', 'type', 'signature');
        expect(log.topics[0]).to.eq('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
      }
    }
  });


  it('add block', async () => {

    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();
    const block = await getBlock(blockNumber);

    const blockCopy = _.cloneDeep(block);
    await addBlock(block);

    expect(_.isEqual(block, blockCopy)).to.equal(true); //check that object hasn't been modified

    const isBlockExists = await models.blockModel.count({_id: block.hash});
    expect(isBlockExists).to.equal(1);
  });

  it('find missed blocks', async () => {
    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();

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

    await Promise.promisify(ctx.web3.eth.sendTransaction)({from: ctx.accounts[0], to: ctx.accounts[1], value: 1});

    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();
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
    const blockNumber = await Promise.promisify(ctx.web3.eth.getBlockNumber)();

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
