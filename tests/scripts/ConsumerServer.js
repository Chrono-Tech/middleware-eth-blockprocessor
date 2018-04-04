
const {spawn} = require('child_process');
const path = require('path');

class Runner {
    constructor() {
        this.child = spawn('node', [path.resolve(__dirname, 'consumer.js')],  {env: process.env});
                // cluster.setupMaster({
        //     exec: __dirname + '/scripts/testRpc.js',
        //     args: [],
        //     //silent: true
        // });
        // childs.push(await cluster.fork());
    }

    kill() {
        this.child.kill();
    }

}

module.exports = Runner;

