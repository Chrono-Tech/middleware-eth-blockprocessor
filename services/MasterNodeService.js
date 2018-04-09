/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const config = require('../config'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'app.services.MasterNodeService'}),
  Promise = require('bluebird'),
  uniqid = require('uniqid');

const MASTER_UPDATE_TIMEOUT = 2000;
const MASTER_FIND_TIMEOUT = 2000;
const MASTER_SYNC_TIMEOUT = 2000;

const EXCHANGE_NAME = 'master_events';

/**
 * @class MasterNode
 *
 * Class, that helps with clasterization process with mode [one master and many slaves]
 *
 * when run this class, though rabbitmq process
 * find exist master and remember ourself as slave
 *
 * when prev master is died or just no response by rabbitmq
 * election for master run away and new Master is done.
 * may be is this process
 *
 *
 *
 */
class MasterNode {

  /**
   *
   * Constructor, that only create main variables in class
   * not done anything work
   *
   * @param _channel [from amqplib] _channel Channel, through send and response messages
   *
   * @memberOf MasterNode
   */
  constructor (_channel) {
    this._myid = uniqid();
    this._queues = {
      findMasterQueue: `${config.rabbit.serviceName}_findMaster_${this._myid}`,
      findMasterRoute: `${config.rabbit.serviceName}_findMaster`,
      setMasterQueue: `${config.rabbit.serviceName}_setMaster_${this._myid}`,
      setMasterRoute: `${config.rabbit.serviceName}_setMaster`
    };

    this.channel = _channel;
    this._isMaster = false;
    this._currentMaster = undefined;
  }

  async _sendSetMasterEvent () {
    await this.channel.publish(EXCHANGE_NAME, this._queues.setMasterRoute, new Buffer(this._myid));
  }

  async _onFindMasterEvent () {
    await this.channel.assertQueue(this._queues.findMasterQueue, {autoDelete: true});
    await this.channel.bindQueue(this._queues.findMasterQueue, EXCHANGE_NAME, this._queues.findMasterRoute, {autoDelete: true});

    this.channel.consume(this._queues.findMasterQueue, async (message) => {
      if (this._isMaster)
        await this._sendSetMasterEvent();

      this.channel.ack(message);
    });
  }

  async _onSetMasterEvent () {
    await this.channel.assertQueue(this._queues.setMasterQueue, {autoDelete: true});
    await this.channel.bindQueue(this._queues.setMasterQueue, EXCHANGE_NAME, this._queues.setMasterRoute, {autoDelete: true});

    this.channel.consume(this._queues.setMasterQueue, async (message) => {
      this._currentMaster = message.content.toString();
      this._isMaster = (this._currentMaster === this._myid);

      this.channel.ack(message);
    });
  }

  async _sendFindMasterEvent () {
    await this.channel.publish(EXCHANGE_NAME, this._queues.findMasterRoute, new Buffer(this._myid));
  }

  async _updateMaster () {
    this._currentMaster = undefined;
    log.info(`master-node#${this._myid}: syncing: started`);

    await this._sendFindMasterEvent();
    log.info(`master-node#${this._myid}: syncing: found`);

    await Promise.delay(MASTER_FIND_TIMEOUT);

    if (!this._currentMaster) {
      await this._sendSetMasterEvent();
      log.info(`master-node#${this._myid}: syncing: try to set master`);

      await Promise.delay(MASTER_SYNC_TIMEOUT);
    }

    if (this._isMaster)
      log.info(`master-node#${this._myid}: syncing: the following process took master role`);

    log.info(`master-node#${this._myid}: syncing: finished`);

  }

  /**
   *
   * Async start function
   * in this function process subscribe on main events in rabbitmq, connected to elections
   * and through MASTER_UPDATE_TIMEOUT run periodic checkMasterProcess
   *
   * @memberOf MasterNode
   */
  async start () {
    await this.channel.assertExchange(EXCHANGE_NAME, 'direct', {autoDelete: true});
    this._onSetMasterEvent();
    this._onFindMasterEvent();
    await Promise.delay(MASTER_UPDATE_TIMEOUT);
    await this._updateMaster();

    if (!this._isMaster)
      await new Promise(res => {
        let intervalUpdateId = setInterval(async () => {
          await this._updateMaster();

          if (this._isMaster) {
            clearInterval(intervalUpdateId);
            res();
          }

        }, MASTER_UPDATE_TIMEOUT * 5);
      });
  }

}

module.exports = MasterNode;
