# syntax=docker/dockerfile:1

FROM node:26-alpine AS base
RUN npm install -g pnpm@12.16.1
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY e2e/package.json e2e/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/contract-client/package.json packages/contract-client/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @skillescrow/contract-client build \
  && pnpm --filter @skillescrow/api exec prisma generate \
  && pnpm --filter @skillescrow/api build:vercel \
  && pnpm --filter @skillescrow/api build:worker

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages ./packages

USER node
EXPOSE 3001

# Same image runs either the API server (default) or the background worker:
#   API:    node apps/api/dist/server.mjs
#   Worker: node apps/api/dist/worker.mjs
CMD ["node", "apps/api/dist/server.mjs"]
