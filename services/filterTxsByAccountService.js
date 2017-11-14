/**
 * Transaction filter
 * @module services/filterTxsByAccount
 * @requires models/accountModel
 */

const _ = require('lodash'),
  accountModel = require('../models/accountModel');

module.exports = async (txs) => {
  let query = {
    $or: [
      {
        address: {
          $in: _.chain(txs)
            .map(tx =>
              _.union(tx.logs.map(log => log.address), [tx.to, tx.from])
            )
            .flattenDeep()
            .uniq()
            .value()
        }
      },
      {
        $or: _.chain(txs)
          .map(tx =>
            _.chain([tx.to, tx.from])
              .transform((acc, val) => {
                if (!val) return;
                acc.push({[`erc20token.${val}`]: {$exists: true}});
              })
              .value()
          )
          .flattenDeep()
          .uniqWith(_.isEqual)
          .value()
      }
    ]
  };

  let accounts = await accountModel.find(query);

  accounts = _.chain(accounts)
    .map(account => [..._.keys(account.erc20token), account.address])
    .flattenDeep()
    .value();

  return _.chain(txs)
    .filter(tx => {
      let emittedAccounts = _.union(tx.logs.map(log => log.address), [tx.to, tx.from]);

      return _.find(accounts, account =>
        emittedAccounts.includes(account)
      );
    })
    .value();
};
