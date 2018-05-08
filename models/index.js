const requireAll = require('require-all'),
  config = require('../config'),
  url = require('url').URL,
  DataSource = require('loopback-datasource-juggler').DataSource;

const storages = {};

if (config.storage.accounts.type === 'couchdb2') {
  let parsedUri = new url(config.storage.accounts.uri);
  storages.accounts = new DataSource(config.storage.accounts.type, {
    url: parsedUri.origin,
    database: parsedUri.pathname.replace('/', '')
  });
} else {
  storages.accounts = new DataSource(config.storage.accounts.type, {url: config.storage.accounts.uri});
}

if (config.storage.data.type === 'couchdb2') {
  let parsedUri = new url(config.storage.data.uri);
  storages.data = new DataSource(config.storage.data.type, {
    url: parsedUri.origin,
    database: parsedUri.pathname.replace('/', '')
  });
} else {
  storages.data = new DataSource(config.storage.data.type, {url: config.storage.data.uri});
}

const models = requireAll({
  dirname: __dirname,
  filter: /(.+Model)\.js$/,
  resolve: model => model(storages)
});

const init = async () => {

  models.blockModel.hasMany(models.txModel, {as: 'txs'});
  models.txModel.belongsTo(models.blockModel, {as: 'block'});

  models.txModel.hasMany(models.txLogsModel, {as: 'txlogs'});
  models.txLogsModel.belongsTo(models.txModel, {as: 'tx'});

  for (let model of [models.accountModel.definition.name])
    await storages.accounts.autoupdate([model]).catch(async () => {
      await storages.accounts.automigrate([model]);
    });

  for (let model of [models.txModel.definition.name, models.blockModel.definition.name, models.txLogsModel.definition.name])
    await storages.data.autoupdate([model]).catch(async () => {
      await storages.data.automigrate([model]);
    });

};

module.exports = {
  models: models,
  storages: storages,
  init: init
};
