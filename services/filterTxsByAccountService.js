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

  let addresses = _.chain(txs)
    .map(tx =>
      _.union(tx.logs.map(log => log.address), [tx.to, tx.from])
    )
    .flattenDeep()
    .uniq()
    .chunk(100)
    .value();


  let filteredByChunks = await Promise.all(addresses.map(chunk =>
    models.accountModel.find({
      address: {
        $in: chunk
      },
      isActive: {
        $ne: false
      }
    })
  ));

  return _.chain(filteredByChunks)
    .flatten()
    .map(account => [..._.keys(account.erc20token), account.address])
    .flattenDeep()
    .uniq()
    .map(address => ({
      address: address,
      txs: _.filter(txs, tx =>
        _.union(tx.logs.map(log => log.address), [tx.to, tx.from]).includes(address)
      )
    })
    )
    .value();
};
