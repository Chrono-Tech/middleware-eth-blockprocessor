const { spawn } = require('child_process'),
    path = require("path"); 

module.exports = () => {
    return spawn(
        'node',
        [path.resolve(__dirname, '..', '..', 'ipcConverter.js')],
        {'env': {'PORT': '8546'}}
    );
}