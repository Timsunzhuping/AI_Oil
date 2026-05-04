FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages/
COPY services/ai-service services/ai-service/

RUN pnpm install --frozen-lockfile

WORKDIR /app/services/ai-service

EXPOSE 3002

CMD ["pnpm", "dev"]
