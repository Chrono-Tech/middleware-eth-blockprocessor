const config = require('../../config');

config['dev']= {
    uri:  `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${`/tmp/${(process.env.NETWORK || 'development')}/geth.ipc`}`,
    testUri:  `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${`/tmp/${(process.env.NETWORK || 'development')}-test/geth.ipc`}`,
    httpUri: 'http://localhost:8545'
};
module.exports = config;



