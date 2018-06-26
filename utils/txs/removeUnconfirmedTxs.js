const providerService = require('../../services/providerService'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  models = require('../../models');

module.exports = async () => {

  let web3 = await providerService.get();

  const pendingBlock = await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);

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