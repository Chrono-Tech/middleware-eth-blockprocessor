/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

require('dotenv/config');

const models = require('../../models'),
  config = require('../../config'),
  _ = require('lodash'),
  RMQBlockModel = require('middleware-common-components/models/rmq/eth/blockModel'),
  RMQTxModel = require('middleware-common-components/models/rmq/eth/txModel'),
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

  it('validate block event', async () => {

    const generatedBlockNumbers = [];

    await Promise.all([
      (async () => {
        await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_features.block`, {autoDelete: true});
        await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_features.block`, 'events', `${config.rabbit.serviceName}_block`);
        await new Promise(res =>
          ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_features.block`, async data => {

            if (!data)
              return;

            const message = JSON.parse(data.content.toString());
            new RMQBlockModel(message);

            _.pull(generatedBlockNumbers, message.block);

            if (generatedBlockNumbers.length)
              return;

            await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_features.block`);
            res();
          }, {noAck: true})
        );
      })(),
      (async () => {
        for (let number = 1; number <= 100; number++) {
          let tx = await ctx.web3.eth.sendTransaction({
            from: ctx.accounts[0],
            to: ctx.accounts[1],
            value: 1000
          });

          generatedBlockNumbers.push(tx.blockNumber);
        }
      })()
    ]);
  });

  it('validate transaction event for registered user', async () => {

    await new models.accountModel({address: ctx.accounts[0]}).save();

    let tx;

    return await Promise.all([
      (async () => {
        await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_features.transaction`, {autoDelete: true});
        await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_features.transaction`, 'events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[0]}`);
        await new Promise(res =>
          ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_features.transaction`, async data => {

            if (!data)
              return;

            const message = JSON.parse(data.content.toString());

            new RMQTxModel(message);

            if (tx && message.hash !== tx.transactionHash)
              return;

            await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_features.transaction`);
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
      })()
    ]);
  });


  it('validate transaction event for not registered user', async () => {
    let tx;

    return await Promise.all([
      (async () => {
        await ctx.amqp.channel.assertQueue(`app_${config.rabbit.serviceName}_test_features.transaction`, {autoDelete: true});
        await ctx.amqp.channel.bindQueue(`app_${config.rabbit.serviceName}_test_features.transaction`, 'events', `${config.rabbit.serviceName}_transaction.${ctx.accounts[1]}`);
        await new Promise((res, rej) => {
          ctx.amqp.channel.consume(`app_${config.rabbit.serviceName}_test_features.transaction`, (data) => {
            if (data)
              rej();
          }, {noAck: true});

          let checkInterval = setInterval(async () => {

            if (!tx)
              return;

            let txExist = await models.txModel.count({_id: tx.transactionHash});

            if (!txExist)
              return;

            clearInterval(checkInterval);
            await ctx.amqp.channel.deleteQueue(`app_${config.rabbit.serviceName}_test_features.transaction`);
            res();
          }, 2000);
        });
      })(),
      (async () => {
        tx = await ctx.web3.eth.sendTransaction({
          from: ctx.accounts[0],
          to: ctx.accounts[1],
          value: 1000
        });
      })()
    ]);
  });


  after('kill environment', async () => {
    ctx.blockProcessorPid.kill();
  });


};
