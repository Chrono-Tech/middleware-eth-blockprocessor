FROM node:8-slim
ENV NETWORK_TYPE DEFAULT_NETWORK_TYPE
ENV NPM_CONFIG_LOGLEVEL warn
RUN apt update && \
    apt install -y python make g++ git build-essential && \
    npm install -g pm2@2.7.1 && \
    mkdir /app
WORKDIR /app
RUN git clone https://github.com/ChronoBank/Middleware.git src
RUN cd src && \
    npm -g install --unsafe-perm=true && \
    node . middleware-eth-blockprocessor && \
    node . middleware-eth-rest && \
    node . middleware-eth-chrono-sc-processor && \
    node . middleware-eth-balance-processor && \
    node . middleware-eth-ipfs && \
    node . middleware-eth-erc20
EXPOSE 8080
CMD pm2-docker start /mnt/config/${NETWORK_TYPE}/ecosystem.config.js