const requireAll = require('require-all');

/** @factory
 *  @description search for all controllers and expose them
 */
module.exports = requireAll({
  dirname     :  __dirname,
  filter      :  /(.+Factory)\.js$/,
  recursive: true
});