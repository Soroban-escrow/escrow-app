# skillescrow-app
TypeScript monorepo (pnpm). Packages: `shared` (amounts, fee math, /bounty parser), `contract-client` (generated bindings), `apps/api` (Fastify, webhook receiver, Prisma schema).
Run `pnpm install && pnpm test`. Contract repo: `../skillescrow-contracts`.

After a fresh clone: `pnpm install`, build the client (`pnpm --filter @skillescrow/contract-client build`), and run `pnpm --filter @skillescrow/api exec prisma generate` (needs `DATABASE_URL`).

**Deploying the web app:** `API_INTERNAL_URL` is read when `next build` runs (Next bakes rewrite destinations into the build), so set it at build time, not only at start.
