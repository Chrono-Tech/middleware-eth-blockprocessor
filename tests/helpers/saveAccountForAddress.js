/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const models = require('../../models');
module.exports = async (account) => {
    return await new models.accountModel({address: account}).save();
};