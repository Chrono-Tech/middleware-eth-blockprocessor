const _ = require('lodash'),
  accountModel = require('../models').accountModel,
  transactionModel = require('../models').transactionModel;

module.exports = async (txs) => {

  let accounts = await accountModel.find({
    address: {
      $in: _.chain(txs)
        .map(tx =>
          _.union(tx.logs.map(log => log.address), [tx.to, tx.from])
        )
        .flattenDeep()
        .uniq()
        .value()
    }
  });

  accounts = _.map(accounts, account => account.address);

  return _.chain(txs)
    .filter(tx => {
      let emittedAccounts = _.union(tx.logs.map(log => log.address), [tx.to, tx.from]);

      return _.find(accounts, account =>
        emittedAccounts.includes(account)
      );
    })
    .map(tx => {
      tx.value = parseInt(tx.value);
      tx.blockNumber = parseInt(tx.blockNumber, 16);
      return new transactionModel(tx);
    })
    .value();

};