FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache docker-cli

ENV NODE_ENV=production \
    PORT=8081

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY lib ./lib
COPY data ./data
COPY server.js ./

RUN mkdir -p /app/data

EXPOSE 8081

CMD ["node", "server.js"]
