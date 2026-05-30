FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./server.js
COPY server ./server

ENV PORT=4000
ENV DIVANE_DB_DIR=/data

EXPOSE 4000

CMD ["node", "server.js"]
