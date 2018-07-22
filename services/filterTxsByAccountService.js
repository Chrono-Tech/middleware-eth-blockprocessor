/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const _ = require('lodash'),
  models = require('../models');

/**
 * @service
 * @description filter txs by registered addresses
 * @param txs - an array of txs
 * @returns {Promise.<*>}
 */

module.exports = async (txs) => {

  if (!txs.length)
    return [];

  let query = {
    isActive: {$ne: false},
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

  let accounts = await models.accountModel.find(query);

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
