const Web3 = require('web3'),
  net = require('net'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  web3Errors = require('web3/lib/web3/errors'),
  EventEmitter = require('events'),
  config = require('../config'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'app.services.web3Service'}),
  web3 = new Web3();

const TIMEOUT_WAIT = 9000 * Math.floor(Math.random() * 100);

/**
 * timout for providers in miliseconds, where provider not retry connected
 */
const TIMEOUT_PROVIDER_WAIT = 5000;

/**
 * 
 * 
 * @class ProviderContext
 * 
 * Class for choosen more apropriate provider for web3
 * 
 */
class ProviderContext {


  constructor (urls, events) {
    this.events = events;
    this.currentIndex = -1;
    this.providers = _.chain(urls)
      .map(url => { return {url: url, 'lastError': 0}; }).value();


    this._createProvider = (uri) => {
      if (/^http/.test(uri)) 
        return new Web3.providers.HttpProvider(uri);
      else 
        return new Web3.providers.IpcProvider(`${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${uri}`, net);
      
    };
    
    this._onDisconnectProvider = () => {
      const currentProvider = this.providers[this.currentIndex];
      if (currentProvider)
        currentProvider.lastError = Date.now();
      this.syncProvider();
    };
    
    this._onDisconnectAll = () => {
      this.events.emit('end');
    };
    
    this._isTimeoutEnded = (provider) => {
      return (Date.now() - provider.lastError > TIMEOUT_PROVIDER_WAIT);
    };
    
    
    this._connectWeb3Provider =  (provider) => {
      web3.setProvider(provider);
      if (web3.currentProvider.connection) 
        web3.currentProvider.connection.on('end', () => {
          this._onDisconnectProvider();
        });

    };
    
    this._tryConnectProvider = (provider, index) => {
      const netProvider = this._createProvider(provider.url);
      if (netProvider.isConnected()) {
    
        provider.lastError = null;
    
        this._connectWeb3Provider(netProvider);
        this.currentIndex = index;  
        log.info('change provider to ' + provider.url);
        this.events.emit('provider_change', netProvider);
        return provider;
      } else {
        provider.lastError = Date.now();
    
        return false;
      }
    };
    
    this._connectMorePriorProvider = () => {
      return _.slice(this.providers, 0, this.currentIndex)
        .find((provider, index) =>
          (this._isTimeoutEnded(provider) && this._tryConnectProvider(provider, index))
        ) !== undefined;
    };
    
    this._connectLessPriorProvider = () => {
      return _.slice(this.providers, this.currentIndex+1)
        .find((provider, index) => 
          (this._isTimeoutEnded(provider) && this._tryConnectProvider(provider, index))
        ) !== undefined;
    };

    this._isCurrentConnected = () => {
      return web3.currentProvider !== undefined && web3.currentProvider.isConnected();
    };
  }

  setErrorProvider () {
    this._onDisconnectProvider();
  }

    

  /**
   * 
   * begin try to reconnect (only with waiting time > timeout ) 
   *        to providers more priority
   * and last if we lost connection on current provider
   * try to reconnect (only with waiting time > timeout )  
   *          to providers less priority
   * 
   * @memberOf ProviderContext
   */
  syncProvider () {
    this._connectMorePriorProvider();
    if (!this._isCurrentConnected() && !this._connectLessPriorProvider()) 
      this._onDisconnectAll();
  }
}

/**
 * Proxy class to distribute web3 functions
 * and use urls providers to reconnect more priority provider
 * 
 * @class Web3Service
 */
class Web3Service {

  /**
   * Creates an instance of Web3Service.
   * @param {string} urls url of providers [http:// ipc://] 
   * 
   * generate events:
   * end - for disconnect all providers
   * pending - for pending transaction
   * 
   * @memberOf Web3Service
   */
  constructor (urls) {
    this.events = new EventEmitter();        

    this._provider = new ProviderContext(urls, this.events);
    this._provider.syncProvider();


  }

  /**
   * start for watching pending transaction and generate events
   */
  startWatching () {
    this.pending = web3.eth.filter('pending').watch((err, tx) => {
      return this.events.emit('pending', [err, tx]);
    });
  }
  /**
   * 
   * stop watch penging transaction in web3
   * @returns 
   * 
   * @memberOf Web3Service
   */
  async stopWatching () {
    if (this.pending) 
      return await web3.eth.filter.stopWatching(this.pending);
  }

  /**
   * @returns string
   * get network name
   * 
   * @memberOf Web3Service
   */
  getNetwork () {
    return config.web3.network;
  }

  async _execute (command) {
    try {
      return await command();
    } catch(err) {
      this._provider.setErrorProvider();
    }
  }


  /**
   * web3.eth.getBlockNumber
   * 
   * @returns string
   * 
   * @memberOf Web3Service
   */
  async getBlockNumber () {
    this._provider.syncProvider();
    return this._execute(async () => 
      await Promise.promisify(web3.eth.getBlockNumber)().timeout(TIMEOUT_WAIT)
    );
  }
  /**
   * web3.eth.getTransaction
   * 
   * @param {string} txHash 
   * @returns {Object} tx
   * 
   * @memberOf Web3Service
   */
  async getTransaction (txHash) {
    this._provider.syncProvider();
    return this._execute(async () => 
      await Promise.promisify(web3.eth.getTransaction)(txHash).timeout(TIMEOUT_WAIT)
    );
  }

  /**
   * web3.eth.getBlock
   * 
   * @param {string} number 
   * @param {boolean} [withTransactions=false] 
   * @returns {Object} block
   * 
   * @memberOf Web3Service
   */
  async getBlock (number, withTransactions = false) {
    return this._execute(async () => 
      await Promise.promisify(web3.eth.getBlock)(number, withTransactions).timeout(TIMEOUT_WAIT)
    );
  }


  /**
   * 
   * web3.eth.getTransactionReceipt
   * 
   * @param {Array} transactionHashs 
   * @returns Array
   * 
   * @memberOf Web3Service
   */
  async getTransactionReceipts (transactionHashs) {
    return this._execute(async () => 
      await Promise.map(transactionHashs, 
        tx => Promise.promisify(web3.eth.getTransactionReceipt)(tx.hash), {concurrency: 1})
    );
  }



  /**
   * web3.eth.getSyncing
   * 
   * @returns Object
   * 
   * @memberOf Web3Service
   */
  async getSyncing () {
    return this._execute(async () => 
      await Promise.promisify(web3.eth.getSyncing)().timeout(TIMEOUT_WAIT)
    );
  }

  /**
   * web3.eth.getBlock('pending', withTransactions)
   * 
   * @param {boolean} [withTransactions=false] 
   * @returns 
   * 
   * @memberOf Web3Service
   */
  async getBlockPending (withTransactions = false) {
    return this._execute(async () => 
      await Promise.promisify(web3.eth.getBlock)('pending', withTransactions).timeout(TIMEOUT_WAIT)
    );
  }

  /**
   * check is error about invalid connection err
   * 
   * @param {Error} err 
   * @returns boolean
   * 
   * @memberOf Web3Service
   */
  isInvalidConnectionError (err) {
    return err.toString() === web3Errors.InvalidConnection('on IPC').toString();
  }
}


module.exports = Web3Service;
