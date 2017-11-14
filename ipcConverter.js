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
  log = bunyan.createLogger({name: 'ipcConverter'}),
  TestRPC = require('ethereumjs-testrpc');

let RPCServer = TestRPC.server();
RPCServer.listen(8545);

// create RPC server
const server = net.createServer(stream => {
  stream.on('data', c => {
    try {
      let payload = JSON.parse(c.toString());
      RPCServer.provider.sendAsync(payload, (err, data) => {
        stream.cork();
        stream.write(JSON.stringify(err || data));
        process.nextTick(() => stream.uncork());
      });

    } catch (e) {
      log.error(e);
      stream.write(JSON.stringify({
        message: e,
        code: -32000
      }));
    }
  });
})
  .on('error', err => {
  // If pipe file exists try to remove it & start server again
    if(err.code === 'EADDRINUSE' && removePipeFile(config.web3.uri))
      server.listen(config.web3.uri);
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
  let pathIpc = path.parse(config.web3.uri).dir;

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
    removePipeFile(config.web3.uri);
  } catch (e) {}
  process.exit();
});

//Going to start server 
server.listen(config.web3.uri, () => {
  log.info(`Server: on listening for network - ${config.web3.network}`);
});
