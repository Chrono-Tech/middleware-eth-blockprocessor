const net = require('net'),
  config = require('./config'),
  bunyan = require('bunyan'),
  fs = require('fs'),
  log = bunyan.createLogger({name: 'ipcConverter'}),
  request = require('request'),
  TestRPC = require('ethereumjs-testrpc');

let RPCServer = TestRPC.server();
RPCServer.listen(8545);

const server = net.createServer(stream => {

  stream.on('data', c => {

    try {
      let payload = JSON.parse(c.toString());
      RPCServer.provider.sendAsync(payload, (err, data) => {
        stream.write(JSON.stringify(err || data));
      });

    } catch (e) {
      log.error(e);
      stream.write(JSON.stringify({}));
    }

  });

});

if (!/^win/.test(process.platform) && !fs.existsSync(`/tmp/${config.web3.network}`)) {
  fs.mkdirSync(`/tmp/${config.web3.network}`);
}

server.listen(config.web3.uri, () => {
  log.info(`Server: on listening for network - ${config.web3.network}`);
});

