const   amqp = require('amqplib'),
    Promise = require('bluebird');
const uniqid = require('uniqid');
const MasterNode = require('../../services/MasterNode');
const myid = uniqid();

console.log('START');

const main = async () => {

  let amqpInstance = await amqp.connect('amqp://localhost:5672')
  .catch(() => {
    log.error('rabbitmq process has finished!');
    process.exit(0);
  });
  let channel = await amqpInstance.createChannel();

  channel.on('close', () => {
    log.error('rabbitmq process has finished!');
    process.exit(0);
  });

  const masterNode = new MasterNode(channel, console.log);
  await masterNode.start();

  await channel.assertExchange('super_events', 'direct', {autoDelete: true});
  await channel.assertQueue(`super${myid}`);
  await channel.bindQueue(`super${myid}`, 'super_events', `super_sender`, {autoDelete: true});


  channel.consume(`super${myid}`, async (message) => {
    if (!await masterNode.isSyncMaster()) {
      return;
    }
    
    await channel.publish('super_events', `super_consumer`, new Buffer(myid));
    
    channel.ack(message);
  });



}

main();
