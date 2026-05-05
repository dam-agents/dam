FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/

RUN pnpm install --frozen-lockfile --filter platform-ui...

COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/ui/ packages/ui/

RUN pnpm --filter platform-ui build

FROM nginxinc/nginx-unprivileged:1-alpine

COPY --from=build /app/packages/ui/dist /usr/share/nginx/html

EXPOSE 8080
