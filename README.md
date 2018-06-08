# middleware-eth-blockprocessor [![Build Status](https://travis-ci.org/ChronoBank/middleware-eth-blockprocessor.svg?branch=master)](https://travis-ci.org/ChronoBank/middleware-eth-blockprocessor)

Middleware service for handling incoming transactions

### Installation

This module is a part of middleware services. You can install it in 2 ways:

1) through core middleware installer  [middleware installer](https://github.com/ChronoBank/middleware)
2) by hands: just clone the repo, do 'npm install', set your .env - and you are ready to go

#### About
This module is used for watching new blocks and txs for registered on platform users (please, check out - how you can register new user via [rest api](https://github.com/ChronoBank/middleware-eth-rest)).


#### How does it work?

Block processor connects to ipc / http endpoint, fetch blocks one by one and cache them in mongodb.

Which txs block processor filter?

Block processor filter txs by specified user accounts (addresses). The addresses are presented in "ethaccounts" collection with the following format:
```
{
    "_id" : ObjectId("599fd82bb9c86c7b74cc809c"),
    "address" : "0x1cc5ceebda535987a4800062f67b9b78be0ef419",
    "balance" : 0.0,
    "created" : 1503647787853
}
```

So, when someone, for instance send a transaction (sample from web3 console):
```
/* eth.accounts[0] - "0x1cc5ceebda535987a4800062f67b9b78be0ef419" */
eth.sendTransaction({from: eth.accounts[0], to: eth.accounts[1], value: 200})
```

this tx is going to be included in next blocks. Block parser fetch these blocks, and filter by "to" and "from" recipients, or by addresses from logs (in case we want to catch event).
If one of them is presented in ethaccounts collection in mongo, then this transaction will be broadcasted via rabbitmq.

```
{
    "hash" : "0xb432ff1b436ab7f2e6f611f6a52d3a44492c176e1eb5211ad31e21313d4a274f",
    "blockHash" : "0x6ab9c9c59749fe43557876836066854d84e7e936c1f27832c05642762d16eb0a",
    "blockNumber" : "3",
    "from" : "0x1cc5ceebda535987a4800062f67b9b78be0ef419",
    "to" : "0x48bf12c5650d87007b81e2b1a91bdf6e3d6ede03",
    "value" : "200",
    "created" : ISODate("2017-08-25T08:04:57.389Z"),
        "logs" : [
        {
            "type" : "mined",
            "topics" : [
                "0xd03c2206e12a8eb3553d780874e1a7941b9c67f3a726ce6edb4a9fd65e25ec98",
                "0x4c48540000000000000000000000000000000000000000000000000000000000"
            ],
            "data" : "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000004720d48945567aae0d30996288a7d150cad4486a",
            "address" : "0x0c2f47f14e597b914479f7301455b590471b70b2",
            "blockNumber" : 16,
            "blockHash" : "0x69a00a0a08165a86fe76c3a3074909d7d5fc9a382cb0b74bf5083bd1e20073cd",
            "transactionHash" : "0xdfe76fd315f15cf94e715307772063cb1775d41be39d52ad22eae3118b9862c3",
            "transactionIndex" : 0,
            "logIndex" : 0
        }
    ],
}
```

Why do we use rabbitmq?


Rabbitmq is used for 2 main reasons - the first one for inner communication between different core modules. And the second one - is for notification purpose. When a new transaction arrives and it satisfies the filter - block processor notiffy others about it though rabbitmq exhange strategy. The exchage is called 'events', and it has different kinds of routing keys. For a new tx the routing key is looked like so:

```
<RABBIT_SERVICE_NAME>_transaction.{address}
```
Where address is to or from address. Also, you can subscribe to all eth_transactions events by using wildcard:
```
<RABBIT_SERVICE_NAME>_transaction.*
```

All in all, in order to be subscribed, you need to do the following:
1) check that exchange 'events exist'
2) assert a new queue (this should be your own unique queue)
3) bind your queue to 'events' exchange with appropriate routing key
4) consume (listen) your queue


But be aware of it - when a new tx arrives, the block processor sends 2 messages for the same one transaction - for both addresses, who participated in transaction (from and to recepients). The sent message represent the payload field from transaction object (by this unique field you can easely fetch the raw transaction from mongodb for your own purpose).


### multiple providers
In order to increase stability and speed up the syncing process itself, we have introduced an ability to specify several connections to nodes via ipc / http. The worflow is simple:
1) during caching, the necessary blocks, which should be processed, are processed serially (from last known height down to 0 height) through one chosen provider
2) the povider is going to be choosed by the round-robbin strategy. This strategy happens every 5 minutes, in order to check that speed of current provider hasn't degradated.
3) During scanning for the latest blocks, we pick up only single connection (through the race condition). In case, the connection got down - we pick up another one.


#### cache system
In order to make it possible to work with custom queries (in [rest](https://github.com/ChronoBank/middleware-eth-rest)), or perform any kind of analytic tasks, we have introduced the caching system. This system stores all blocks and txs in mongodb under the specific collections: ethblocks, ethtxes, ethtxlogs.


##### ethblocks
The blocks collection stores only the most valuable information about the block. Here is the example of block:
```
    "_id" : "0x85e0b80172426e9be5202a8a7a7d8d035340072bbed2e357ee80029a26ab9244",
    "__v" : 0,
    "number" : 2379390,
    "timestamp" : 1527760928,
    "totalTxFee" : NumberLong(10704416000000000),
    "uncleAmount" : 0
```

Here is the description:

| field name | index | description|
| ------ | ------ | ------ |
| _id   | true | the hash of block
| number   | true | the block number
| totalTxFee   | false | total received fee from all txs, included in block (useful for calculating the block reward)
| uncleAmount   | false | total unclue amount (useful for calculating the block reward)


##### ethtxes
The ethtxes collection stores only the most valuable information about the transaction. Here is the example of transaction:
```
    "_id" : "0x3a2c4269effb9ca2271d1cf0c42ddad0ed741c5961024dcc7b3dab1a5e161058",
    "blockNumber" : 2379392,
    "from" : "0x1fabf3c6d95dbba5b54034f62dd8bc2f71abbd9b",
    "gas" : NumberLong(405474),
    "gasPrice" : NumberLong(1000000000),
    "index" : 14,
    "nonce" : 596,
    "to" : "0xfe2149773b3513703e79ad23d05a778a185016ee",
    "value" : NumberLong(3000000000000000)
```

Here is the description:

| field name | index | description|
| ------ | ------ | ------ |
| _id   | true | the hash of transaction
| blockNumber   | false | the block number
| from   | true | from address (who sent tx)
| gas   | false | the gas
| gasPrice   | false | the gas price
| index   | true | the transaction index in block
| nonce   | false | unique incremented field (in describe the total amount of already performed transactions count + 1 from the "from" address)
| to   | true | to address (who received tx)
| value   | false | the sent amount of money


##### ethtxlogs
The ethtxlogs collection stores only the most valuable information about the transaction's logs. Here is the example of the log:
```
    "_id" : "1120c77a38f4379eae6a077931919f38",
    "address" : "0xfe2149773b3513703e79ad23d05a778a185016ee",
    "blockNumber" : 2379392,
    "index" : 2,
    "removed" : false,
    "signature" : "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "topics" : [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    ],
    "txIndex" : 1
```

Here is the description:

| field name | index | description|
| ------ | ------ | ------ |
| _id   | true | mongo generated id
| address   | true | the address, from which the log has been emitted
| blockNumber   | true | block number
| index   | true | log index
| removed   | false | has log been removed
| signature   | true | it's the topics[0]. Useful, in case you need to find event by signature
| topics   | false | the topics array
| txIndex   | true | the transaction index


##### сonfigure your .env

To apply your configuration, create a .env file in root folder of repo (in case it's not present already).
Below is the expamle configuration:

```
MONGO_ACCOUNTS_URI=mongodb://localhost:27017/data
MONGO_ACCOUNTS_COLLECTION_PREFIX=eth

MONGO_DATA_URI=mongodb://localhost:27017/data
MONGO_DATA_COLLECTION_PREFIX=eth

RABBIT_URI=amqp://localhost:5672
RABBIT_SERVICE_NAME=app_eth
NETWORK=development

SYNC_SHADOW=1

PROVIDERS=tmp/development/geth.ipc,tmp/development/geth2.ipc
```

The options are presented below:

| name | description|
| ------ | ------ |
| MONGO_URI   | the URI string for mongo connection
| MONGO_COLLECTION_PREFIX   | the default prefix for all mongo collections. The default value is 'eth'
| MONGO_ACCOUNTS_URI   | the URI string for mongo connection, which holds users accounts (if not specified, then default MONGO_URI connection will be used)
| MONGO_ACCOUNTS_COLLECTION_PREFIX   | the collection prefix for accounts collection in mongo (If not specified, then the default MONGO_COLLECTION_PREFIX will be used)
| MONGO_DATA_URI   | the URI string for mongo connection, which holds data collections (for instance, processed block's height). In case, it's not specified, then default MONGO_URI connection will be used)
| MONGO_DATA_COLLECTION_PREFIX   | the collection prefix for data collections in mongo (If not specified, then the default MONGO_COLLECTION_PREFIX will be used)
| RABBIT_URI   | rabbitmq URI connection string
| RABBIT_SERVICE_NAME   | namespace for all rabbitmq queues, like 'app_eth_transaction'
| NETWORK   | network name (alias)- is used for connecting via ipc (see block processor section)
| SYNC_SHADOW   | sync blocks in background, or await, until the whole blockchain will be cached in db
| PROVIDERS   | the paths to ipc / http interface, written with comma sign
| WEB3_URI (deprecated)   | the path to ipc interface

License
----
 [GNU AGPLv3](LICENSE)

Copyright
----
LaborX PTY