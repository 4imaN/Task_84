FROM node:20-alpine

WORKDIR /workspace

COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/db/package.json packages/db/package.json

RUN npm ci

COPY . .

RUN npm run build
RUN chmod +x scripts/start-container.sh

EXPOSE 4000

CMD ["sh", "scripts/start-container.sh"]
