const mongoose = require('mongoose'),
  messages = require('../factories').messages.accountMessageFactory;

require('mongoose-long')(mongoose);

/** @model accountModel
 *  @description account model - represents an eth account
 */
const Account = new mongoose.Schema({
  address: {
    type: String,
    unique: true,
    required: true,
    validate: [a=>  /^(0x)?[0-9a-fA-F]{40}$/.test(a), messages.wrongAddress]
  },
  balance: {type: mongoose.Schema.Types.Long, default: 0},
  created: {type: Date, required: true, default: Date.now},

});

module.exports = mongoose.model('EthAccount', Account);
