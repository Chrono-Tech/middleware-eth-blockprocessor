const config = require('../config');

module.exports = (ds) => {
  return ds.data.define(`${config.storage.data.collectionPrefix}TxLogs`, {
    txHash: {type: String},
    removed: {type: Boolean},
    logIndex: {type: Number},
    data: {type: String},
    signature: {type: String}, //0 topic
    topics: {type: Array, default: []},
    address: {type: String}
  }, {
    indexes: {
      tx_logs_tx_hash_index: {txHash: 1},
      tx_logs_signature_index: {signature: 1},
      tx_logs_address_index: {address: 1}
    }
  });
};
