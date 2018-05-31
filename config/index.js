/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Chronobank/eth-blockprocessor configuration
 * @module config
 * @returns {Object} Configuration
 */

require('dotenv').config();
const _ = require('lodash');

const config = {
  mongo: {
    accounts: {
      uri: process.env.MONGO_ACCOUNTS_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/data',
      collectionPrefix: process.env.MONGO_ACCOUNTS_COLLECTION_PREFIX || process.env.MONGO_COLLECTION_PREFIX || 'eth'
    },
    data: {
      uri: process.env.MONGO_DATA_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/data',
      collectionPrefix: process.env.MONGO_DATA_COLLECTION_PREFIX || process.env.MONGO_COLLECTION_PREFIX || 'eth'
    }
  },
  rabbit: {
    url: process.env.RABBIT_URI || 'amqp://localhost:5672',
    serviceName: process.env.RABBIT_SERVICE_NAME || 'app_eth'
  },
  sync: {
    shadow: parseInt(process.env.SYNC_SHADOW) || true
  },
  web3: {
    network: process.env.NETWORK || 'development',
    providers: _.chain(process.env.PROVIDERS).split(',')
      .map(provider => provider.trim())
      .filter(provider => provider.length)
      .thru(prov => prov.length ? prov : [
        `${process.env.WEB3_URI || `/tmp/${(process.env.NETWORK || 'development')}/geth.ipc`}`
      ])
      .value()
  }
};

module.exports = config;
