const config = require('../config');

module.exports = (ds) => {
  return ds.data.define(`${config.storage.data.collectionPrefix}Block`, {
    id: {type: Number, id: true, generated: false},
    number: {type: Number},
    hash: {type: String},
    timestamp: {type: Number, required: true},
    created: {type: Date, required: true, default: Date.now}
  }, {
    indexes: {
      block_number_index: {number: 1},
      block_hash_index: {hash: 1},
      block_timestamp_index: {timestamp: 1}
    }
  });

};
