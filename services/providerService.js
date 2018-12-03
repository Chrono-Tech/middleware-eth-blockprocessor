/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  config = require('../config'),
  Web3 = require('web3'),
  sem = require('semaphore')(1),
  net = require('net'),
  providerServiceInterface = require('middleware-common-components/interfaces/blockProcessor/providerServiceInterface'),
  Promise = require('bluebird'),
  EventEmitter = require('events'),
  log = bunyan.createLogger({name: 'core.blockProcessor.services.syncCacheService', level: config.logs.level});

/**
 * @service
 * @description the service for handling connection to node
 * @returns Object<ProviderService>
 */

class providerService {

  constructor () {
    this.events = new EventEmitter();
    this.connector = null;
    this.filter = null;

    if (config.web3.providers.length > 1)
      this.findBestNodeInterval = setInterval(() => {
        this.switchConnectorSafe();
      }, 60000 * 5);
  }

  /**
   * @function
   * @description build web3 instance from provided URI
   * @param providerURI - the connection uri
   * @return {Web3}
   */
  makeWeb3FromProviderURI (providerURI) {

    if (/^http/.test(providerURI) || /^ws/.test(providerURI))
      return new Web3(providerURI);

    providerURI = `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${providerURI}`;
    return new Web3(providerURI, net);
  }

  /** @function
   * @description reset the current connection
   * @return {Promise<void>}
   */
  async resetConnector () {

    if (this.filter) {
      //await Promise.promisify(this.filter.unsubscribe.bind(this.connector))();
      await new Promise(res => this.filter.unsubscribe(res));
      this.filter = null;
    }

    if (_.has(this.connector, 'currentProvider.connection.close'))
      this.connector.currentProvider.connection.close();
    this.switchConnector();

  }

  /**
   * @function
   * @description choose the connector
   * @return {Promise<null|*>}
   */
  async switchConnector () {

    console.log('switching connector')
    const providerURI = await Promise.any(config.web3.providers.map(async providerURI => {
      const web3 = this.makeWeb3FromProviderURI(providerURI);
      await web3.eth.getBlockNumber();
      if (_.has(web3, 'currentProvider.connection.close'))
        web3.currentProvider.connection.close();
      return providerURI;
    })).catch(() => {
      log.error('no available connection!');
      process.exit(0); //todo move to root
    });

    console.log('switched connector')

    const fullProviderURI = !/^http/.test(providerURI) ? `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${providerURI}` : providerURI;
    const currentProviderURI = this.connector ? this.connector.currentProvider.path || this.connector.currentProvider.host : '';

    if (currentProviderURI === fullProviderURI)
      return;

    this.connector = this.makeWeb3FromProviderURI(providerURI);

    if (_.get(this.connector.currentProvider, 'connection')) {

/*      this.connector.currentProvider.connection.on('end', () => this.resetConnector());
      this.connector.currentProvider.connection.on('error', () => this.resetConnector());*/
      this.connector.currentProvider.connection.onerror(()=>this.resetConnector());
      this.connector.currentProvider.connection.onclose(()=>this.resetConnector());


    } else
      this.pingIntervalId = setInterval(async () => {

        const isConnected = await this.connector.eth.getProtocolVersion().catch(() => null);

        if (!isConnected) {
          clearInterval(this.pingIntervalId);
          this.resetConnector();
        }
      }, 5000);


    this.filter = this.connector.eth.subscribe('pendingTransactions');
    this.filter.on('data', (transaction) => {
      this.events.emit('unconfirmedTx', transaction);
    });

    this.events.emit('provider_set');
    return this.connector;

  }

  /**
   * @function
   * @description safe connector switching, by moving requests to
   * @return {Promise<bluebird>}
   */
  async switchConnectorSafe () {

    console.log('going to switch connector')

    return new Promise(res => {
      sem.take(async () => {
        await this.switchConnector();
        res(this.connector);
        sem.leave();
      });
    });
  }

  /**
   * @function
   * @description
   * @return {Promise<*|bluebird>}
   */
  async get () {

    if(this.connector){
      console.log('is listening: ', await this.connector.eth.getProtocolVersion().catch(()=>null))
    }

    return this.connector && await this.connector.eth.getProtocolVersion().catch(() => false) ? this.connector : await this.switchConnectorSafe();
  }

}

module.exports = providerServiceInterface(new providerService());
