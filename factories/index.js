/** 
 * Bootstrap file for rescursive search for all factories
 * @returns {Object} factories
 */

const requireAll = require('require-all');

module.exports = requireAll({
  dirname     :  __dirname,
  filter      :  /(.+Factory)\.js$/,
  recursive: true
});
