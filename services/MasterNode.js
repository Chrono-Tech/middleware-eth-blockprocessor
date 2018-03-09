const   amqp = require('amqplib'),
    Promise = require('bluebird');
const uniqid = require('uniqid');

const MASTER_UPDATE_TIMEOUT = 2000;
const MASTER_FIND_TIMEOUT = 2000;
const MASTER_SYNC_TIMEOUT = 2000; 
const MASTER_PREV_SYNC_TIMEOUT = 10000; 

const EXCHANGE_NAME='master_events';
  
class MasterNode {

    constructor(_channel, logFunction = () => {}) {
        const myid = uniqid();
        
        this.channel = _channel;
        this._isMaster = false;
        this._isMasterSynced = true;
        this._currentMaster = undefined;
        this._prevSyncTime = Date.now();

        const notFindMaster = () => this._currentMaster === undefined;
        const log = (msg) => logFunction(`master-node#${myid}: ${msg}`);
          


        const sendFindMasterEvent= async() => {
            await this.channel.publish('master_events', 'findMaster', new Buffer(myid));
        }

        this._isPrevSyncFreeze = () => {
            return (Date.now() - this._prevSyncTime) > MASTER_PREV_SYNC_TIMEOUT;
        }

        this._setNewMasterFromEvent = (masterId) => {
            this._currentMaster = masterId;
            this._isMaster = (this._currentMaster === myid); 
        };
    
        this._sendSetMasterEvent = async() => {
            await this.channel.publish(`master_events`, 'setMaster', new Buffer(myid));
        };
        this._onFindMasterEvent = async (handler) => {
            await this.channel.assertQueue(`findMaster${myid}`);
            await this.channel.bindQueue(`findMaster${myid}`, EXCHANGE_NAME, `findMaster`, {autoDelete: true});
        
            this.channel.consume(`findMaster${myid}`, async (message) => {
            await handler(message.content.toString());
                this.channel.ack(message);    
            });
        };

        this._onSetMasterEvent = async (handler) => {
            await this.channel.assertQueue(`setMaster${myid}`);
            await this.channel.bindQueue(`setMaster${myid}`, EXCHANGE_NAME, `setMaster`, {autoDelete: true});
        
            this.channel.consume(`setMaster${myid}`, async(message) => {
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

    async start() {
        await this.channel.assertExchange(EXCHANGE_NAME, 'direct', {autoDelete: true});
        this._onSetMasterEvent(this._setNewMasterFromEvent);
        this._onFindMasterEvent( 
          async () => this._isMaster ? await this._sendSetMasterEvent() : ''
        );
        setTimeout(this._updateMaster, MASTER_UPDATE_TIMEOUT);
    }

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