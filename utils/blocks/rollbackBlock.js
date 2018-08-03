/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  models = require('../../models'),
  config = require('../../config'),
  log = bunyan.createLogger({name: 'core.blockProcessor.utils.addBlock', level: config.logs.level});

/**
 * @function
 * @description rollback the cache to previous block
 * @param blockNumber - block number
 * @return {Promise<void>}
 */
module.exports = async (blockNumber) => {

  const isBlockExists = await models.blockModel.count({number: blockNumber});

  if (!isBlockExists)
    return;

  log.info('rolling back txs state');
  await models.txModel.remove({blockNumber: blockNumber});

  log.info('rolling back tx logs state');
  await models.txLogModel.remove({blockNumber: blockNumber});

  log.info('rolling back blocks state');
  await models.blockModel.remove({number: blockNumber});
};
