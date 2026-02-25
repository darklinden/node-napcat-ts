FROM node:20-alpine

WORKDIR /app

COPY src ./src
COPY package.json ./
COPY package-lock.json ./
COPY test ./test

RUN npm install

CMD ["npx", "tsx", "test/index.ts"]
