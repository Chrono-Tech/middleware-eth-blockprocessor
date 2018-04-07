/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const accountModel = require('../../models/accountModel'),
    blockModel = require('../../models/blockModel');


module.exports =  async function () {
    await accountModel.remove()
    await blockModel.remove()
};