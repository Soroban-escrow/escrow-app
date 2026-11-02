# Progress (app)
Built locally and pushed to `fresh-build`. 73 API tests (+2 live-chain, run with LIVE_CHAIN=1), 2 web tests, `next build` passes.

Done: shared (amounts, fees, /bounty parser) · Prisma schema + migration · chain wrapper · indexer (verified against real testnet events) · /bounty handler · PR tracking · merge-to-payout + relayer job (ports) · wallet linking (SEP-53) · sessions/CSRF/read API · criteria + card · AI reviewer core, Anthropic adapter, 12-case eval set · web pages (/, /b/[id], /u/[login], /me, /install, /docs).

Not done / blocked on the human: GitHub App registration (OAuth login, comment/label client, real webhooks) · ANTHROPIC_API_KEY (eval:ai never run) · Freighter test with a USDC trustline · USDC issuer verification · mainnet anything.
Not done / buildable: BullMQ queue + worker process, relayer signer, funding page and tx build/submit endpoints, maintainer release/refund UI, dispute + admin pages, observability/alerts, Playwright e2e, Lighthouse.
