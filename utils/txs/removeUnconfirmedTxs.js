const providerService = require('../../services/providerService'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  models = require('../../models');

/**
 * @function
 * @description remove unconfirmed transactions, which has been pulled from mempool
 * @return {Promise<void>}
 */
module.exports = async () => {

  let web3 = await providerService.get();

  const pendingBlock = await web3.eth.getBlock('pending');

  if (!_.get(pendingBlock, 'transactions', []).length)
    return;

  if (pendingBlock.transactions.length)
    await models.txModel.remove({
      _id: {
        $nin: pendingBlock.transactions
      },
      blockNumber: -1
    });

};