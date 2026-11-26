# Progress (app)
Built locally and pushed to `fresh-build`. API: 113 tests (+6 live-chain/live-relayer, run with `LIVE_CHAIN=1`), web: 2 unit + 26 Playwright e2e (desktop and 360 px), Lighthouse mobile 100/100 on `/` and `/b/1`.

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
- (GitHub App is registered and verified; the client, card sync and OAuth login are built. See the live-run notes below.)
- `ANTHROPIC_API_KEY` for `pnpm eval:ai` and the live reviewer.
- Freighter in a real browser with a USDC trustline (signing is stubbed/untested; e2e covers the no-Freighter error path).
- Testnet USDC issuer verification (only native XLM is allowlisted on the deployed contract).
- Mainnet: KMS-backed relayer signer, admin multisig, external audit, 7-day staging soak, backups with a tested restore, hosting/domains/error tracking/alert channel.

## GitHub (built after the App was registered)
- `src/github/client.ts`: App JWT -> cached installation tokens, permission lookup, comments, labels, issues, PR files, CI, README. Verified against the real sandbox repo.
- `src/github/sync.ts`: bounty card posted once and edited in place (per-bounty DB lock), title and criteria from the issue, bounty label, payout/reminder comments.
- `src/auth/github-login.ts`: OAuth with PKCE and a signed state cookie; `/auth/login`, `/auth/callback`; admin flag from `ADMIN_GITHUB_IDS`.
- AI review pipeline (`src/ai/pipeline.ts`, `src/worker/review-queue.ts`): fetches the PR, reviews against the bounty criteria, caps per PR/repo per day, code-enforced injection downgrade, duplicate and CI flags, rank across PRs, one edited comment per PR, 5 minute debounce, `/bounty review`. Tested with a mocked model and real Redis/Postgres. Switches on when `ANTHROPIC_API_KEY` is set; **never run against the real model**.
- "Paid X to @login (tx)" comment on release (any path), wallet-link sweep wired in the API.
- **Verified live on testnet + real GitHub:** `/bounty` comment -> funding link -> real funding in Freighter -> indexed -> card and label on the issue. Still to run live: PR from a second account, merge, relayer payout, and the refund and dispute paths.

## Known limits
- The relayer retry recognises a payment that already landed (bounty Released to the expected winner) and confirms it; a release to anyone else is a failure.
- The live indexer test reads a ~28 h window of testnet history and will stop finding the smoke events once the RPC retention window passes them.
