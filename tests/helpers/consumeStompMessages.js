/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const config = require('../../config');
module.exports = async(maxCount = 1, client, parseMessage) => {
    return new Promise(res  => client.connect('guest', 'guest', () => {
        let messageCount = 1;
        const subscriber = client.subscribe(`/exchange/events/${config.rabbit.serviceName}_transaction.*`, async (message) => {
            parseMessage(message);

            if (messageCount === maxCount) {
                await subscriber.unsubscribe();
                res();
            } else {
                messageCount++;
            }
        });
  }));
}