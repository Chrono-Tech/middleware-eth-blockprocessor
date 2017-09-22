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
    request.post('http://localhost:8545', {body: c.toString()}, (err, resp, body) => {
      try {
        JSON.parse(body);
        stream.write(body);
      } catch (e) {
        log.error(e);
      }
    });
  });

});

if (!/^win/.test(process.platform) && !fs.existsSync(`/tmp/${config.web3.network}`)) {
  fs.mkdirSync(`/tmp/${config.web3.network}`);
}

server.listen(config.web3.uri, () => {
  log.info(`Server: on listening for network - ${config.web3.network}`);
});

