/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const config = require('../../config');

module.exports = async (channel) => {
    await channel.assertExchange('events', 'topic', {durable: false});
    const balanceQueue = await channel.assertQueue(`app_${config.rabbit.serviceName}_test.transaction`);
    await channel.bindQueue(`app_${config.rabbit.serviceName}_test.transaction`, 'events', `${config.rabbit.serviceName}_transaction.*`);
    return balanceQueue;
};