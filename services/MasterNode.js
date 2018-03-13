const amqp = require('amqplib'),
    config = require('../config'),
    Promise = require('bluebird');
const uniqid = require('uniqid');

const MASTER_UPDATE_TIMEOUT = 2000;
const MASTER_FIND_TIMEOUT = 2000;
const MASTER_SYNC_TIMEOUT = 2000; 
const MASTER_PREV_SYNC_TIMEOUT = 10000; 

const EXCHANGE_NAME='master_events';

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
     * @param Channel [from amqplib] _channel Channel, through send and response messages 
     * @param function [logFunction=() => {}] function for log main messages
     * 
     * @memberOf MasterNode
     */
    constructor(_channel, logFunction = () => {}) {
        const myid = uniqid(),
            findMasterQueue = `${config.rabbit.serviceName}_findMaster_${myid}`,
            findMasterRoute = `${config.rabbit.serviceName}_findMaster`,
            setMasterQueue = `${config.rabbit.serviceName}_setMaster_${myid}`,
            setMasterRoute = `${config.rabbit.serviceName}_setMaster`;

        
        this.channel = _channel;
        this._isMaster = false;
        this._isMasterSynced = true;
        this._currentMaster = undefined;
        this._prevSyncTime = Date.now();

        const notFindMaster = () => this._currentMaster === undefined;
        const log = (msg) => logFunction(`master-node#${myid}: ${msg}`);
          


        const sendFindMasterEvent= async() => {
            await this.channel.publish('master_events', findMasterRoute, new Buffer(myid));
        }

        this._isPrevSyncFreeze = () => {
            return (Date.now() - this._prevSyncTime) > MASTER_PREV_SYNC_TIMEOUT;
        }

        this._setNewMasterFromEvent = (masterId) => {
            this._currentMaster = masterId;
            this._isMaster = (this._currentMaster === myid); 
        };
    
        this._sendSetMasterEvent = async() => {
            await this.channel.publish(`master_events`, setMasterRoute, new Buffer(myid));
        };
        this._onFindMasterEvent = async (handler) => {
            await this.channel.assertQueue(findMasterQueue);
            await this.channel.bindQueue(findMasterQueue, EXCHANGE_NAME, findMasterRoute, {autoDelete: true});
        
            this.channel.consume(findMasterQueue, async (message) => {
            await handler(message.content.toString());
                this.channel.ack(message);    
            });
        };

        this._onSetMasterEvent = async (handler) => {
            await this.channel.assertQueue(setMasterQueue);
            await this.channel.bindQueue(setMasterQueue, EXCHANGE_NAME, setMasterRoute, {autoDelete: true});
        
            this.channel.consume(setMasterQueue, async(message) => {
                handler(message.content.toString());
                this.channel.ack(message);
            });
        };

        this._updateMaster = async () => {
            this._prevSyncTime = Date.now();            
            this._isMasterSynced = false;
            this._currentMaster = undefined;
            log('syncing: started');
        
            await sendFindMasterEvent();
            log('syncing: finded');
            await Promise.delay(MASTER_FIND_TIMEOUT);

            if (notFindMaster()) {
                await this._sendSetMasterEvent();
                log('syncing: try to set master');
                await Promise.delay(MASTER_SYNC_TIMEOUT);
            }

            if (this._isMaster) {
            log('syncing: I MASTER')
            }

            log('syncing: finished')      
            this._isMasterSynced = true;
        };
        
    }

    /**
     * 
     * Async start function
     * in this function process subscribe on main events in rabbitmq, connected to elections
     * and through MASTER_UPDATE_TIMEOUT run periodic checkMasterProcess
     * 
     * @memberOf MasterNode
     */
    async start() {
        await this.channel.assertExchange(EXCHANGE_NAME, 'direct', {autoDelete: true});
        this._onSetMasterEvent(this._setNewMasterFromEvent);
        this._onFindMasterEvent( 
          async () => this._isMaster ? await this._sendSetMasterEvent() : ''
        );
        setTimeout(this._updateMaster, MASTER_UPDATE_TIMEOUT);
    }

    /**
     * 
     * Async isSyncMaster function
     * check is Master this process, or not
     * 
     * and is not master run forced check exists master in network or not
     * 
     * @returns boolean
     * 
     * @memberOf MasterNode
     */
    async isSyncMaster() {
        if (!this._isMasterSynced) {
            await Promise.delay(MASTER_SYNC_TIMEOUT);
        }
        if (!this._isMaster) {
          await this._updateMaster();
        }
        return this._isMaster;
    }


}


module.exports = MasterNode;
