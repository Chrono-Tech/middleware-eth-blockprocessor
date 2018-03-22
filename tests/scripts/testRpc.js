const TestRPC = require('ethereumjs-testrpc');
const net = require('net'),
  config = require('../config'),
  bunyan = require('bunyan'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  log = bunyan.createLogger({name: 'testRpc'});


let RPCServer = TestRPC.server();
RPCServer.listen(8546);

// create RPC server
const server = net.createServer(stream => {
    stream.on('data', c => {
      let stringMsg;
      try { 
        stringMsg = c.toString()
          .replace(/}\[{/g, '}{')
          .replace(/}\]{/g, '}{')
          .replace(/}\]\[{/g, '}{')
          .replace(/}{/g, '},{');
        JSON.parse('[' + stringMsg + ']').forEach((string) => {
          RPCServer.provider.sendAsync(string, (err, data) => {
            stream.cork();
            stream.write(JSON.stringify(err || data));
            process.nextTick(() => stream.uncork());
          });
        });
      } catch (e) {
        log.error(stringMsg);
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
      if(err.code === 'EADDRINUSE' && removePipeFile(config.dev.testUri))
        server.listen(config.dev.testUri);
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
    let pathIpc = path.parse(config.dev.testUri).dir;
  
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
      removePipeFile(config.dev.testUri);
    } catch (e) {}
    process.exit();
  });


  //Going to start server 
server.listen(config.dev.testUri, () => {
    log.info(`Server: on listening for network - ${config.web3.network}`);
  });
