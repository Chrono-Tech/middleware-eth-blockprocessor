const {spawn} = require('child_process'),
    config = require('./config'),
    Promise = require('bluebird'),
    consumeMessages = require('./helpers/consumeMessages'),
    expect = require('chai').expect,
    amqp = require('amqplib'),
    cluster = require('cluster');


describe('multiple node blocks test', function () {
  
  let childs = [];
  let channel;

  before(async () => {

    cluster.setupMaster({
        exec: __dirname + '/scripts/consumer.js',
        args: [],
        silent: true
    });
    amqpInstance = await amqp.connect(config.rabbit.url);
    channel = await amqpInstance.createChannel();

  });



  afterEach(async () => {
    childs.forEach(child => {
        child.kill('SIGHUP');
    });
    childs = [];
    await Promise.delay(1000);
  });


  it('send three messages, 4 consumers and wait in rabbitmq only three messages', async () => {


    childs.push(await cluster.fork());
    childs.push(await cluster.fork());
    childs.push(await cluster.fork());
    childs.push(await cluster.fork());

    await channel.assertExchange('super_events', 'direct', {autoDelete: true});

    return await Promise.all([
        (async() => {
            await Promise.delay(5000);
            await channel.publish('super_events', `super_sender`, new Buffer(1));
            await channel.publish('super_events', `super_sender`, new Buffer(2));
            return await channel.publish('super_events', `super_sender`, new Buffer(3));
        })(),
        (async () => {
          await channel.assertQueue(`super_test`);
          await channel.bindQueue(`super_test`, 'super_events', `super_consumer`, {autoDelete: true});
          await consumeMessages(3, channel, (message) => {
              expect.toString(message.content.toString());
          }, 'super_test');

          const queue = await channel.assertQueue(`super-test`);
          expect(queue.messageCount).to.equal(0);
          return;
        })(),
      ]);
  });

  it('send three messages, 3 consumers, kill master consumer and wait in rabbitmq  three messages', async () => {

    childs.push(await cluster.fork());
    await Promise.delay(4000);    
    childs.push(await cluster.fork());
    childs.push(await cluster.fork());
    
    await channel.assertExchange('super_events', 'direct', {autoDelete: true});

    return await Promise.all([
        (async() => {
            await channel.publish('super_events', `super_sender`, new Buffer(1));
            await Promise.delay(4000);            
            childs[0].kill('SIGHUP');
            await Promise.delay(2000);
            await channel.publish('super_events', `super_sender`, new Buffer(2));
            await channel.publish('super_events', `super_sender`, new Buffer(3));
        })(),
        (async () => {
          await channel.assertQueue(`super_test`);
          await channel.bindQueue(`super_test`, 'super_events', `super_consumer`, {autoDelete: true});
          return await consumeMessages(3, channel, (message) => {
              expect.toString(message.content.toString());
          }, 'super_test');

          const queue = await channel.assertQueue(`super-test`);
          expect(queue.messageCount).to.equal(0);
        })(),
      ]);
  });

  it('send three messages, 1 consumer, kill consumer and run two 2 consumer and wait in rabbitmq  three messages', async () => {

    childs.push(await cluster.fork());
    await Promise.delay(4000);    
    
    await channel.assertExchange('super_events', 'direct', {autoDelete: true});

    return await Promise.all([
        (async() => {
            await channel.publish('super_events', `super_sender`, new Buffer(1));
            await Promise.delay(4000);    
            childs[0].kill('SIGHUP');
            childs.push(await cluster.fork());
            childs.push(await cluster.fork());
            await Promise.delay(3000);

            await channel.publish('super_events', `super_sender`, new Buffer(2));
            await channel.publish('super_events', `super_sender`, new Buffer(3));
        })(),
        (async () => {
          await channel.assertQueue(`super_test`);
          await channel.bindQueue(`super_test`, 'super_events', `super_consumer`, {autoDelete: true});
          return await consumeMessages(3, channel, (message) => {
              expect.toString(message.content.toString());
          }, 'super_test');

          const queue = await channel.assertQueue(`super-test`);
          expect(queue.messageCount).to.equal(0);
        })(),
      ]);
  });      
  
});

