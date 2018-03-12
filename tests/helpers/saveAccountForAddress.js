const accountModel = require('../../models/accountModel');
module.exports = async (account) => {
    return await new accountModel({address: account}).save();
};