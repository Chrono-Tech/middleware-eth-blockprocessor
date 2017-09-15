const requireAll = require('require-all');

/** @factory
 *  @description search for all Models and expose them
 */
module.exports = requireAll({
  dirname     :  __dirname,
  filter      :  /(.+Model)\.js$/,
});
