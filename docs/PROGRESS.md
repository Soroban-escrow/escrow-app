# Progress (app)
Built locally and pushed to `fresh-build`. 73 API tests (+2 live-chain, run with LIVE_CHAIN=1), 2 web tests, `next build` passes.

Done: shared (amounts, fees, /bounty parser) · Prisma schema + migration · chain wrapper · indexer (verified against real testnet events) · /bounty handler · PR tracking · merge-to-payout + relayer job (ports) · wallet linking (SEP-53) · sessions/CSRF/read API · criteria + card · AI reviewer core, Anthropic adapter, 12-case eval set · web pages (/, /b/[id], /u/[login], /me, /install, /docs).

Not done / blocked on the human: GitHub App registration (OAuth login, comment/label client, real webhooks) · ANTHROPIC_API_KEY (eval:ai never run) · Freighter test with a USDC trustline · USDC issuer verification · mainnet anything.
Added later: funding intents + tx build/submit API, `/fund/[intentId]` page, maintainer release/refund (API + `/me` buttons), BullMQ webhook queue + dispatcher + installation handling + worker entrypoint (`pnpm worker`; signed webhook -> API -> Redis -> worker -> Postgres verified locally), admin/dispute API (queue, open on chain, resolve, reject, payout retry, status) with audit log.
Not done / buildable: relayer signer + job scheduling (a retried payout is set QUEUED but nothing enqueues `relayRelease` yet), real GitHub client, admin web UI, observability/alerts beyond `/admin/status`, Playwright e2e, Lighthouse, refund reminder comments, resolve/dispute comment posting.
