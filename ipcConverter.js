/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

/**
 * Rise a testrpc server
 * @module testrpc-server
 * @requires ethereumjs-testrpc
 */

const net = require('net'),
  config = require('./config'),
  bunyan = require('bunyan'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  log = bunyan.createLogger({name: 'ipcConverter'}),
  dbPath = path.join(__dirname, 'testrpc_db'),
  TestRPC = require('ganache-cli');

const accounts = [
  '6b9027372deb53f4ae973a5614d8a57024adf33126ece6b587d9e08ba901c0d2',
  '993130d3dd4de71254a94a47fdacb1c9f90dd33be8ad06b687bd95f073514a97',
  'c3ea2286b88b51e7cd1cf09ce88b65e9c344302778f96a145c9a01d203f80a4c',
  '51cd20e24463a0e86c540f074a5f083c334659353eec43bb0bd9297b5929bd35',
  '7af5f0d70d97f282dfd20a9b611a2e4bd40572c038a89c0ee171a3c93bd6a17a',
  'cfc6d3fa2b579e3023ff0085b09d7a1cf13f6b6c995199454b739d24f2cf23a5'
].map(privKey => ({secretKey: Buffer.from(privKey, 'hex'), balance: Math.pow(10, 32).toString(16)}));

if (!fs.existsSync(dbPath))
  fs.mkdirSync(dbPath);

let RPCServer = TestRPC.server({accounts: accounts, default_balance_ether: 1000, db_path: dbPath, network_id: 86});
RPCServer.listen(parseInt(process.env.RPC_PORT || 8545));
const web3ProviderUri = `${/^win/.test(process.platform) ? '\\\\.\\pipe\\' : ''}${config.web3.providers[0]}`;

let addresses = _.chain(RPCServer.provider.manager.state.accounts)
  .toPairs()
  .map(pair => {
    pair[1] = Buffer.from(pair[1].secretKey, 'hex').toString('hex');
    return pair;
  })
  .fromPairs()
  .value();

console.log(addresses);

// create RPC server
const server = net.createServer(stream => {
  stream.on('data', c => {
    try {
      const stringMsg = c.toString();
      RPCServer.provider.sendAsync(JSON.parse(stringMsg), (err, data) => {
        stream.cork();
        stream.write(JSON.stringify(err || data));
        process.nextTick(() => stream.uncork());
      });
    } catch (e) {
      stream.write(JSON.stringify({
        message: e,
        code: -32000
      }));
    }
  });
})
  .on('error', err => {
    // If pipe file exists try to remove it & start server again
    if (err.code === 'EADDRINUSE' && removePipeFile(web3ProviderUri))
      server.listen(web3ProviderUri);
    else
      process.exit(1);
  });

/**
 * Remove pipe file
 * @param  {string} filename Path to pipe file
 * @return {boolean}         Whether file removed or not
 */
const removePipeFile = filename => {
  try {
    fs.accessSync(filename, fs.F_OK | fs.W_OK) || fs.unlinkSync(filename);
    return true;
  } catch (e) {
    log.error(e.message);
    return false;
  }
};

// Create directory for Win32
if (!/^win/.test(process.platform)) {
  let pathIpc = path.parse(web3ProviderUri).dir;

  if (!fs.existsSync(pathIpc))
    fs.mkdirSync(pathIpc);
}

// Clean up pipe file after shutdown process

/**
 * Stub for windows. Emulate SIGINT for Win32
 */
if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('SIGINT', function () {
    process.emit('SIGINT');
  });
}

process.on('SIGINT', function () {
  try {
    removePipeFile(web3ProviderUri);
  } catch (e) {
  }
  process.exit();
});

//Going to start server 
server.listen(web3ProviderUri, () => {
  log.info(`Server: on listening for network - ${config.web3.network}`);
});
