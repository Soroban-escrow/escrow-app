# Progress (app)
Built locally and pushed to `fresh-build`. API: 109 tests (+6 live-chain/live-relayer, run with `LIVE_CHAIN=1`), web: 2 unit + 24 Playwright e2e (desktop and 360 px), Lighthouse mobile 100/100 on `/` and `/b/1`.

## Done
- **shared**: exact amounts, fee math (same vectors as the contract), `/bounty` parser.
- **API**: config, signed + deduplicated webhooks, sessions (hashed) + CSRF, SEP-53 wallet linking, public read API, funding intents + tx build/submit, maintainer release/refund builders, admin/dispute routes with audit log, per-user rate limits, `/health` (db, RPC, Redis, indexer lag).
- **Indexer**: decoder, idempotent apply, paged polling, dispute status follows chain events. Verified against real testnet events.
- **Payouts**: merge-to-payout state machine, relayer signer (testnet env key), serialized release loop with backoff. **Verified with a real testnet release** (funded a bounty, relayer released it once, never twice).
- **Worker** (`pnpm worker`): BullMQ webhook queue (dedupe by delivery id), dispatcher, installation handling, indexer loop, relayer loop, alert checks (relayer balance, failed payouts, indexer lag, overdue disputes, merged-unpaid near refund), refund reminders.
- **AI reviewer**: prompt with untrusted-data tagging, schema validation + retry, ranking, dedup hash, Anthropic adapter, 12-case eval set. **Never run against the real model.**
- **Web**: `/`, `/b/[id]`, `/u/[login]`, `/me` (wallet link, funded bounties, release/refund), `/fund/[intentId]`, `/admin`, `/install`, `/docs`.
- **CI**: actions pinned by SHA, gitleaks (checksum-pinned), `pnpm audit`, Playwright, Redis + Postgres services.

## Not done / blocked on the human
- GitHub App registration: GitHub OAuth login, the real comment/label/card client, live webhooks, PR/diff fetching for the reviewer. Until then the worker fails GitHub jobs loudly (queue retries) and reminders only log.
- `ANTHROPIC_API_KEY` for `pnpm eval:ai` and the live reviewer.
- Freighter in a real browser with a USDC trustline (signing is stubbed/untested; e2e covers the no-Freighter error path).
- Testnet USDC issuer verification (only native XLM is allowlisted on the deployed contract).
- Mainnet: KMS-backed relayer signer, admin multisig, external audit, 7-day staging soak, backups with a tested restore, hosting/domains/error tracking/alert channel.

## Known limits
- One PR can be tracked against one bounty (PullRequest.id is the primary key).
- The relayer loop marks a payout FAILED if the bounty is no longer Open when it retries; the indexer still confirms it from the chain event if the earlier transaction landed.
- The live indexer test reads a ~28 h window of testnet history and will stop finding the smoke events once the RPC retention window passes them.
