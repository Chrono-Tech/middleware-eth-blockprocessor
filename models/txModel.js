const config = require('../config');

module.exports = (ds) => {
  return ds.data.define(`${config.storage.data.collectionPrefix}Tx`, {
    blockNumber: {type: Number, required: true, default: -1},
    timestamp: {type: Number, required: true, default: Date.now},
    value: {type: String},
    transactionIndex: {type: Number},
    to: {type: String},
    nonce: {type: Number},
    hash: {type: String},
    gasPrice: {type: String},
    gas: {type: String},
    from: {type: String},
    created: {type: Date, required: true, default: Date.now}
  }, {
    indexes: {
      tx_block_number_index: {blockNumber: 1},
      tx_timestamp_index: {timestamp: 1},
      tx_hash_index: {hash: 1},
      to_index: {to: 1},
      tx_from_index: {from: 1},
    }
  });
};
