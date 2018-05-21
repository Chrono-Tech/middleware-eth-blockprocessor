const config = require('../config'),
  net = require('net'),
  Web3 = require('web3');

let web3s = [];

const init = async () => {

  web3s = config.web3.providers.map((providerURI) => {
    const provider = /^http/.test(providerURI) ?
      new Web3.providers.HttpProvider(providerURI) :
      new Web3.providers.IpcProvider(`${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${providerURI}`, net);

    const web3 = new Web3();
    web3.setProvider(provider);

    if (_.has(web3, 'currentProvider.connection.on')) {
      web3.currentProvider.connection.on('end', async () => {
        await Promise.delay(5000);
        web3.reset();
      });

      web3.currentProvider.connection.on('error', async () => {
        await Promise.delay(5000);
        web3.reset();
      });
    }

    return web3;
  });

  return web3s;

};


module.exports = async ()=>{
  return web3s.length ? web3s : await init();
};
