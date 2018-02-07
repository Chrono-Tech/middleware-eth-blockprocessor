FROM node:8
ENV NETWORK_TYPE DEFAULT_NETWORK_TYPE
ENV NPM_CONFIG_LOGLEVEL warn

RUN apt update && \
    apt install -y python make g++ git build-essential && \
    npm install -g pm2@2.7.1 && \
    mkdir /app
WORKDIR /app

RUN mkdir src && mkdir src/core
COPY . src/core/middleware-eth-blockprocessor
RUN cd src/core/middleware-eth-blockprocessor && npm install

RUN npm install -g chronobank-middleware --unsafe
RUN cd src && \
    dmt init && \
    dmt install middleware-eth-chrono-sc-processor \
    middleware-eth-balance-processor \
    middleware-eth-ipfs \
    middleware-eth-erc20 \
    middleware-eth-rest \
    middleware-eth-nem-action-processor
EXPOSE 8080
CMD pm2-docker start /mnt/config/${NETWORK_TYPE}/ecosystem.config.js