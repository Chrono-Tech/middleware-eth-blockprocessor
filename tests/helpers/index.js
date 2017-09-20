const require_all = require('require-all');

module.exports = require_all({
  dirname     :  __dirname,
  filter      :  /^(?!index)(.+)\.js$/,
});