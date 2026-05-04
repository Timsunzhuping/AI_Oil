FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages/
COPY apps/backend apps/backend/

RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/backend

RUN pnpm build

EXPOSE 3001

CMD ["pnpm", "start"]
