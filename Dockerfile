# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY characters/interfaces/package.json characters/interfaces/package.json
COPY characters/runtime/package.json characters/runtime/package.json
COPY characters/hubert/package.json characters/hubert/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY elsewhere/server/package.json elsewhere/server/package.json
COPY elsewhere/web/package.json elsewhere/web/package.json

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY app app
COPY characters characters
COPY packages packages
COPY elsewhere/server elsewhere/server
COPY scripts/inference-operator.ts scripts/auth-operator.ts scripts/
RUN pnpm build:server

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM node:22.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DATA_DIR=/tmp/elsewhere MODEL_PROVIDER=local
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/server.mjs ./dist/server.mjs
COPY --from=build --chown=node:node /app/dist/inference.mjs ./dist/inference.mjs
COPY --from=build --chown=node:node /app/dist/inference-operator.mjs ./dist/inference-operator.mjs
COPY --from=build --chown=node:node /app/dist/auth-operator.mjs ./dist/auth-operator.mjs
COPY --from=build --chown=node:node /app/dist/research.mjs ./dist/research.mjs
RUN install -d -o node -g node -m 0700 /var/lib/elsewhere-inference /var/lib/elsewhere-research /home/node/.ssh && usermod -s /bin/bash node
USER node
EXPOSE 4000
CMD ["node", "dist/server.mjs"]
