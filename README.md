<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/banner-dark.svg">
  <img alt="SkillEscrow — merge is the approval. Paid GitHub issues, settled in USDC on Stellar." src="docs/img/banner-light.svg">
</picture>

<p align="center">
  <b>Maintainers lock USDC on a GitHub issue. Contributors open pull requests.<br>
  Merging one pays its author from on-chain escrow, in seconds.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#the-money-path">The money path</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#status">Status</a>
</p>

---

## The problem

Maintainers in reward programmes drown in low-quality pull requests from people chasing bounties.
Reviewing them is the bottleneck — not paying people. And paying people is its own chore: invoices,
chasing, currency conversion, trust in both directions.

SkillEscrow removes both frictions:

| Friction | What we do about it |
|---|---|
| **Paying is slow and manual** | Funds sit in a Soroban contract. The merge *is* the payment trigger. The author is paid within seconds. |
| **Maintainers must trust contributors** | Nothing is paid until a PR is merged. Nothing merged by the deadline? The maintainer reclaims the funds. |
| **Contributors must trust maintainers** | Funds are visibly locked on-chain *before* any work starts. The maintainer cannot spend them elsewhere. |
| **Reviewing a pile of PRs is slow** | An AI reviews each PR against the issue's acceptance criteria and ranks them. Advisory only — it never moves money. |

**Merging is the approval.** Maintainers already merge good PRs; we add no new approval habit.

---

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor M as Maintainer
    participant GH as GitHub
    participant SE as SkillEscrow
    participant C as Soroban contract
    actor Con as Contributor

    M->>GH: comment "/bounty 50 USDC 14d" on issue #35;7
    GH-->>SE: issue_comment webhook
    SE->>GH: bot replies with a funding link
    M->>SE: open link, sign in Freighter
    SE->>C: fund_bounty(...)  — 50 USDC leaves the maintainer
    C-->>SE: funded event (indexed)
    SE->>GH: bounty card + "bounty: 50 USDC" label on the issue

    Con->>GH: pull request — "Closes #35;7"
    GH-->>SE: pull_request webhook
    SE->>GH: advisory AI review comment, ranked against other PRs

    M->>GH: merge the PR
    GH-->>SE: merged webhook
    SE->>C: release(relayer, bounty, winner)
    C-->>Con: 48.50 USDC   (and 1.50 USDC fee to treasury)
    SE->>GH: "Paid 48.50 USDC to @contributor" + transaction link
```

**If nothing is merged**, the maintainer calls `refund` after the deadline plus a grace period and
gets everything back — no fee. **If something goes wrong**, either side opens a dispute and a human
arbiter splits the funds on-chain.

### Bounty lifecycle

```mermaid
stateDiagram-v2
    [*] --> Open: fund_bounty
    Open --> Released: release — a PR was merged
    Open --> Refunded: refund — deadline + grace passed
    Open --> Disputed: open_dispute
    Disputed --> Resolved: resolve — arbiter splits
    Released --> [*]
    Refunded --> [*]
    Resolved --> [*]
```

One active bounty per `(repository, issue)`. Every terminal state releases the issue so it can be
funded again.

---

## Status

This is a **working testnet system**, not a production product. Being precise about that matters when
money is involved.

**Verified end to end, on Stellar testnet with real GitHub:**

- ✅ `/bounty` comment → permission check → bot posts a funding link
- ✅ Funding signed in Freighter → contract holds the funds → indexer records it
- ✅ Bounty card and label posted on the real issue
- ✅ A relayer release paying a real winner on testnet, proven not to pay twice
- ✅ Contract: fund → release, fund → dispute → resolve, with exact balances
- ✅ Wallet linking (SEP-53 signatures), GitHub OAuth login

**Built and tested, but not yet exercised live end to end:**

- ⏳ Merge → automatic payout, driven by a real merge webhook
- ⏳ Refund (unit-tested; the live grace period is 72 h)
- ⏳ Dispute open/resolve from the admin page
- ⏳ AI review against the real model (works with a mocked model; needs `ANTHROPIC_API_KEY`)

**Not started:** anything on mainnet. See [Before mainnet](#before-mainnet).

| | Tests | Notes |
|---|---|---|
| Contract (Rust) | **63** | Includes a property test of the funds invariant |
| API + worker | **156** | Plus 8 live-chain/live-GitHub tests, opt-in |
| Shared package | **9** | Fee vectors shared with the contract |
| Web | **2** + **26 e2e** | Playwright, desktop and 360 px phone |
| Lighthouse (mobile) | **100 / 100** | Performance / accessibility on `/` and `/b/[id]` |

---

## Repository map

This is the application repo. **The contract lives in [`escrow-contracts`](https://github.com/Soroban-escrow/escrow-contracts).**

```
skillescrow-app/
├── apps/
│   ├── api/                  Fastify server + the worker process
│   │   ├── src/
│   │   │   ├── ai/           review prompt, schema, pipeline, Anthropic adapter
│   │   │   ├── auth/         sessions, CSRF, SEP-53 wallet linking, GitHub OAuth
│   │   │   ├── chain/        Soroban client wrapper, contract error map
│   │   │   ├── github/       App client, /bounty commands, PR tracking, bounty card
│   │   │   ├── indexer/      chain events → database (the source of truth for status)
│   │   │   ├── payouts/      merge→payout state machine, relayer signer + loop
│   │   │   ├── ops/          health, alerts, refund reminders
│   │   │   ├── routes/       the HTTP API
│   │   │   └── worker/       BullMQ queues, event dispatcher, worker entrypoint
│   │   ├── prisma/           schema + migrations
│   │   └── eval/             12-case AI evaluation set (`pnpm eval:ai`)
│   └── web/                  Next.js App Router frontend
├── packages/
│   ├── shared/               exact amounts, fee math, /bounty parser
│   └── contract-client/      generated Soroban bindings (do not hand-edit)
├── e2e/                      Playwright suite
└── docs/                     architecture, GitHub App, runbook, security review
```

### Where to start reading

| If you want to understand… | Read |
|---|---|
| How money can move at all | [`src/payouts/payout.ts`](apps/api/src/payouts/payout.ts) and the contract repo |
| How the database stays truthful | [`src/indexer/`](apps/api/src/indexer/) |
| What the bot does on GitHub | [`src/github/commands.ts`](apps/api/src/github/commands.ts), [`src/github/sync.ts`](apps/api/src/github/sync.ts) |
| How the AI review is kept harmless | [`src/ai/pipeline.ts`](apps/api/src/ai/pipeline.ts), [`src/ai/input.ts`](apps/api/src/ai/input.ts) |
| The whole picture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

---

## Quick start

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **26+** | runtime |
| pnpm | **12.16.1** | workspaces (`npm i -g pnpm`) |
| PostgreSQL | **18** | the database |
| Redis | **8** | job queues |
| Stellar CLI | 28.1.0 | only if you deploy your own contract |

macOS: `brew install postgresql@18 redis && brew services start postgresql@18 && brew services start redis`

### 1. Install and build

```bash
git clone https://github.com/Soroban-escrow/escrow-app.git
cd escrow-app
pnpm install
pnpm --filter @skillescrow/contract-client build   # generated bindings must be compiled once
```

### 2. Create the databases

```bash
createuser skillescrow
psql postgres -c "alter user skillescrow with password 'skillescrow' createdb"
createdb -O skillescrow skillescrow
createdb -O skillescrow skillescrow_test          # for the test suite
```

### 3. Configure

```bash
cp .env.example apps/api/.env
```

At minimum, set `DATABASE_URL`, `SESSION_SECRET` and `CSRF_SECRET`
(`openssl rand -hex 32` twice). `BOUNTY_CONTRACT_ID` already points at the deployed testnet contract.
GitHub and AI features stay switched off until you add their keys — see [Configuration](#configuration).

### 4. Migrate and run

```bash
export DATABASE_URL=postgresql://skillescrow:skillescrow@localhost:5432/skillescrow
pnpm --filter @skillescrow/api exec prisma migrate deploy
pnpm --filter @skillescrow/api exec prisma generate

pnpm --filter @skillescrow/api dev      # API      → http://localhost:3001
pnpm --filter @skillescrow/api worker   # indexer, queues, relayer, alerts
pnpm --filter @skillescrow/web dev      # web app  → http://localhost:3000
```

Check it is alive:

```bash
curl localhost:3001/health
# {"ok":true,"db":true,"rpc":true,"redis":true,"indexerLagLedgers":0}
```

`/health` returns **503** when the database, RPC or Redis is unreachable, or when the indexer has
fallen more than ~5 minutes behind the chain.

### 5. Run the tests

```bash
pnpm -r test                               # unit + integration (needs Postgres + Redis)
pnpm --filter @skillescrow/e2e e2e         # Playwright (needs a skillescrow_e2e database)
```

<details>
<summary><b>Connecting a real GitHub App (optional)</b></summary>

Without a GitHub App the API and worker run fine — the bot simply cannot read or post anything, and
jobs that need GitHub fail loudly so the queue retries them once credentials appear.

To connect one, follow [`docs/GITHUB_APP.md`](docs/GITHUB_APP.md). In short: register the app with
Issues and Pull requests read/write, subscribe to Issues / Issue comment / Pull request, point the
webhook at a [smee.io](https://smee.io) relay locally, **make the app public** (otherwise GitHub
shows every non-owner a 404 at sign-in), and put the five `GITHUB_*` values in `apps/api/.env`.

```bash
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:3001/github/webhooks
pnpm --filter @skillescrow/api sync:installations   # pull installations GitHub already recorded
```
</details>

---

## Architecture

```
        BROWSER                    OUR SERVERS                      ELSEWHERE
   ┌──────────────┐      ┌──────────────────────────────┐
   │ Web          │      │                              │        ┌──────────────┐
   │ Next.js      │─────▶│  API ── Fastify              │◀───────│   GitHub     │
   │              │ /api │   │                          │ signed │ issues · PRs │
   └──────┬───────┘      │   ├──────────────┐           │webhooks└──────▲───────┘
          │ sign         │   ▼              ▼           │               │
   ┌──────▼───────┐      │  Redis       PostgreSQL      │   comments,   │
   │  Freighter   │      │  BullMQ      a cache of      │   labels,     │
   │  the wallet  │      │   │          the chain       │   diffs       │
   └──────┬───────┘      │   ▼              ▲           │               │
          │              │  Worker ─────────┘───────────┼───────────────┘
          │              │   indexer · relayer · review │
          │              │        │                     │        ┌──────────────┐
          │              └────────┼─────────────────────┘        │   Stellar    │
          │  fund · release       │  poll events · release       │              │
          └───────────────────────┴─────────────────────────────▶│ bounty_escrow│
                                                                 │   contract   │
                                                                 └──────────────┘
```

Three rules shape everything above:

1. **The chain is the source of truth for money.** The database is a cache rebuilt from contract
   events. Bounty status is written *only* by the indexer — never by an HTTP handler.
2. **Payout code re-reads the chain before every decision.** It never trusts the database or the
   client about whether a bounty is still open.
3. **The AI is quarantined.** `src/ai/` is never imported by `payouts/` or `chain/`, and a test
   fails the build if that ever changes.

---

## The money path

The part worth reading twice.

### Who can move funds

| Actor | Can do | Cannot do |
|---|---|---|
| **Maintainer** | Fund; release to any non-self address; refund after `deadline + grace`; open a dispute | Take funds back before the deadline; pay themselves |
| **Relayer** (our server) | `release` **only** bounties whose maintainer opted in, only to the recorded winner | Refund, resolve, release opt-out bounties, or exceed the per-token cap |
| **Arbiter** | Open a dispute; split a disputed bounty | Touch a bounty that is not disputed |
| **Admin** | Change config; pause new funding; **upgrade the contract** | — (and so must become a multisig before mainnet) |
| **The AI** | Write an advisory comment | Anything else. It is never an input to a payment |

Pausing blocks **new funding only**. Refunds and dispute resolution always work — funds can always leave.

### Fees

3% of the payout, charged to the maintainer, snapshotted when the bounty is funded so a later fee
change cannot alter it. Refunds are free. Rounding dust always goes to the contributor.

```
50.00 USDC escrowed → 48.50 to the contributor + 1.50 to the treasury
```

### Why you cannot be paid twice

Four independent defences, because this is the expensive failure:

1. **One payout row per bounty**, keyed `release:<bountyId>` and enforced by a unique index — so only the *first* merge wins.
2. **The transaction hash is stored before we wait for confirmation.** A crash mid-flight means the retry *checks that hash* instead of submitting again.
3. **A retry re-reads the chain.** If the bounty is already `Released` to our winner, the payout is marked confirmed rather than re-sent.
4. **The contract itself** only allows `release` from `Open`, so a second attempt fails with `InvalidStatus` regardless.

The relayer processes payouts one at a time — a single signing account, so sequence numbers never race.

### What happens when things go wrong

| Situation | What the system does |
|---|---|
| Contributor has no wallet linked at merge time | Payout waits, bot comments asking them to link one; linking later resumes it automatically |
| Maintainer opted out of relayer release | Payout waits for the maintainer to sign from `/b/<id>` |
| Two PRs merged for one issue | First merge wins; the second gets a comment explaining |
| RPC/network failure | Retried with exponential backoff, up to 5 attempts |
| Contract rejects (e.g. `InvalidStatus`) | Marked failed immediately — retrying cannot help — and surfaced in `/admin` |
| Merged but unpaid, refund window approaching | Admins alerted so an arbiter can step in |

---

## Configuration

All configuration is environment variables, parsed with zod at startup. **Invalid config fails fast
with a readable message** rather than misbehaving later. `apps/api/.env` is loaded automatically and
is git-ignored. See [`.env.example`](.env.example).

### Required

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://skillescrow:skillescrow@localhost:5432/skillescrow` | |
| `REDIS_URL` | `redis://localhost:6379` | |
| `BOUNTY_CONTRACT_ID` | `CCEKBPYC…ZF3J4RKN` | the deployed contract |
| `SESSION_SECRET` | 32+ random chars | `openssl rand -hex 32` |
| `CSRF_SECRET` | 32+ random chars | a *different* value |
| `GITHUB_WEBHOOK_SECRET` | | must match the GitHub App |

### Feature switches

Each group is optional. Leave it unset and that feature stays off.

| Group | Variables | Effect when set |
|---|---|---|
| **GitHub App** | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Bot comments, labels, PR tracking, GitHub sign-in. **All five or none** — a partial set is rejected. |
| **Relayer** | `RELAYER_SECRET`, `RELAYER_MIN_XLM_ALERT` | Automatic release on merge. **Refused outright on mainnet** — use a KMS signer there. |
| **AI review** | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MAX_REVIEWS_PER_PR_PER_DAY`, `AI_MAX_REVIEWS_PER_REPO_PER_DAY` | Advisory PR reviews, capped per PR and per repo per day. |
| **Admin** | `ADMIN_GITHUB_IDS` | Comma-separated GitHub user ids that get `/admin`. Re-applied on every login. |
| **Alerts** | `ALERT_WEBHOOK_URL` | Low relayer balance, failed payouts, indexer lag, stale disputes. |
| **Network** | `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, `TOKEN_USDC_CONTRACT_ID`, `TOKEN_XLM_CONTRACT_ID` | Defaults to Stellar **testnet**. |

> **Note for deployment:** `API_INTERNAL_URL` is read when `next build` runs — Next bakes rewrite
> destinations into the build. Set it at build time, not only at start.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm -r test` | Every unit and integration test |
| `pnpm -r typecheck` | TypeScript, strict, across the workspace |
| `pnpm --filter @skillescrow/api dev` | API server |
| `pnpm --filter @skillescrow/api worker` | Indexer, queues, relayer, alerts, reminders |
| `pnpm --filter @skillescrow/api sync:installations` | Re-read GitHub installations (recovers missed webhooks) |
| `pnpm --filter @skillescrow/api eval:ai` | Run the 12-case AI evaluation — **costs money** |
| `pnpm --filter @skillescrow/web dev` \| `build` | Frontend |
| `pnpm --filter @skillescrow/e2e e2e` | Playwright, desktop + 360 px |

### Running the live tests

Most tests use fakes. A few talk to the real network and are skipped unless you opt in:

```bash
LIVE_CHAIN=1 pnpm --filter @skillescrow/api test          # reads/writes Stellar testnet
LIVE_GITHUB=1 LIVE_REPO=owner/name LIVE_ISSUE=1 \
  LIVE_INSTALLATION=… LIVE_OWNER=… pnpm --filter @skillescrow/api test   # posts to a real repo
```

---

## The HTTP API

All responses use one error shape: `{ "error": { "code": "…", "message": "…" } }`.
Mutations need a session cookie **and** an `X-CSRF-Token` header. Rate limits are per signed-in user,
falling back to per IP.

<details>
<summary><b>Endpoint reference</b></summary>

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | db, RPC, Redis, indexer lag (503 when unhealthy) |
| `GET` | `/auth/login`, `/auth/callback` | — | GitHub OAuth (PKCE) |
| `GET` | `/auth/me` | session | profile + CSRF token |
| `POST` | `/auth/logout` | session + CSRF | |
| `POST` | `/wallet/challenge`, `/wallet/verify` | session + CSRF | SEP-53 wallet linking |
| `DELETE` | `/wallet` | session + CSRF | unlink |
| `GET` | `/bounties` | — | list; filter by status, token, min amount, query; sort; cursor paging |
| `GET` | `/bounties/:id` | — | detail with PRs, reviews, payouts |
| `GET` | `/intents/:id` | — | funding link state |
| `POST` | `/intents/:id/build` | session + CSRF | unsigned `fund_bounty` XDR |
| `POST` | `/bounties/:id/release/build` | maintainer | unsigned `release` XDR |
| `POST` | `/bounties/:id/refund/build` | maintainer | unsigned `refund` XDR |
| `POST` | `/tx/submit` | session + CSRF | relay a signed transaction |
| `GET` | `/me/earnings`, `/me/funded` | session | private |
| `GET` | `/users/:login` | — | public profile (confirmed payouts only) |
| `POST` | `/github/webhooks` | signature | HMAC-verified, deduplicated by delivery id |
| `GET` | `/admin/disputes`, `/admin/payouts`, `/admin/status` | admin | |
| `POST` | `/admin/disputes/:id/{open-onchain,resolve/build,reject}` | admin | arbiter signs in Freighter |
| `POST` | `/admin/payouts/:id/retry` | admin | only when no transaction was submitted |

</details>

### Error Codes and User-Facing Text

Contract errors arrive at the API as `contract_<Name>` and are translated into clear, actionable messages for users. Missing contract errors trigger compile-time errors in `apps/web`:

| Code # | Error Name | API Error Code | User-Facing Message |
|---|---|---|---|
| 1 | `AlreadyInitialized` | `contract_AlreadyInitialized` | This escrow contract has already been initialized. |
| 2 | `NotInitialized` | `contract_NotInitialized` | The escrow contract has not been initialized yet. Contact support. |
| 3 | `Unauthorized` | `contract_Unauthorized` | You do not have authorization to perform this action with your connected wallet. |
| 4 | `Paused` | `contract_Paused` | Funding is currently paused by the administrator. Please try again later. |
| 5 | `TokenNotAllowed` | `contract_TokenNotAllowed` | This token is not on the allowed list for the escrow contract. |
| 6 | `AmountTooSmall` | `contract_AmountTooSmall` | The funding amount is below the minimum required for this token. |
| 7 | `AmountTooLarge` | `contract_AmountTooLarge` | The funding amount exceeds the maximum limit allowed for this token. |
| 8 | `InvalidDeadline` | `contract_InvalidDeadline` | The chosen deadline is outside the permitted duration limits. |
| 9 | `IssueAlreadyFunded` | `contract_IssueAlreadyFunded` | This GitHub issue already has an active funded bounty. |
| 10 | `BountyNotFound` | `contract_BountyNotFound` | The requested bounty was not found on-chain. Please verify the bounty ID. |
| 11 | `InvalidStatus` | `contract_InvalidStatus` | This bounty is no longer open for the requested operation. |
| 12 | `DeadlineNotReached` | `contract_DeadlineNotReached` | The refund window has not opened yet; the deadline must elapse first. |
| 13 | `SelfPayout` | `contract_SelfPayout` | You cannot release a bounty payout to your own wallet address. |
| 14 | `InvalidSplit` | `contract_InvalidSplit` | The dispute payout split percentages must total exactly 100%. |
| 15 | `InvalidFee` | `contract_InvalidFee` | The configured protocol fee basis points are outside the allowable range. |
| 16 | `Overflow` | `contract_Overflow` | The transaction could not be processed because a calculation exceeded arithmetic bounds. |
| 17 | `RelayerNotAllowed` | `contract_RelayerNotAllowed` | Automatic release is switched off for this bounty; the maintainer needs to sign it. |

### Pages

| Route | Who | What |
|---|---|---|
| `/` | everyone | Open bounties, searchable and sortable |
| `/b/[id]` | everyone | Bounty detail: criteria, ranked PRs, payout status |
| `/fund/[intentId]` | maintainer | Sign the funding transaction |
| `/me` | signed in | Wallet linking, funded bounties, release/refund |
| `/u/[login]` | everyone | Public contributor record — portable reputation |
| `/admin` | admins | Dispute queue, failed payouts, system status |
| `/install`, `/docs` | everyone | Onboarding |

---

## Security

The full self-review is in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md). The headlines:

- **Webhooks** are HMAC-verified against the raw body in constant time and deduplicated by delivery id.
- **Sessions and login state are stored hashed.** A leaked table is not a set of logins. Login uses
  PKCE plus a signed, short-lived, browser-bound state cookie, and refuses off-site redirects.
- **Wallet linking** uses single-use SEP-53 challenges burned atomically — concurrent attempts
  resolve to exactly one winner.
- **Untrusted content** (issue bodies, PR bodies, diffs, usernames) is escaped before rendering and
  wrapped in data tags before reaching the model. Attempts to close those tags are defanged.
- **Prompt injection is handled in code, not just in the prompt.** A review that reports an injection
  attempt can never stand as "likely meets", whatever the model returned.
- **No secrets in the repo.** `gitleaks` and `pnpm audit` run in CI; GitHub Actions are pinned by commit SHA.

Found something? Open a private security advisory on the repo rather than a public issue.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/health` returns 503 with `"db": false` | Postgres is down. After an unclean shutdown a stale `postmaster.pid` can block startup — check `brew services list` and the Postgres log. |
| Indexer lag is enormous | It had no cursor and started from the retained window. It catches up on its own; the stored ledger follows the cursor even when the contract is quiet. |
| GitHub shows **404** at sign-in | The GitHub App is private. Make it public, or sign in as the owner account. |
| "Switch Freighter to the network this app uses" | The wallet is on Mainnet. Switch it to Test Net. |
| Config error at startup naming `GITHUB_APP_ID` | GitHub values are all-or-none; one of the five is missing. |
| `ERR_PNPM_IGNORED_BUILDS` | Run `pnpm install` again — `allowBuilds` in `pnpm-workspace.yaml` lists the scripts we permit. |
| Webhooks never arrive locally | The smee relay is not running, or the webhook secret differs between GitHub and `.env`. |

---

## Before mainnet

Hard gates, every one of them requiring a human decision:

- [ ] Relayer key in a KMS/HSM — the env-var key is **refused** on mainnet by the config
- [ ] Admin moved to a multisig account (the admin can upgrade the contract)
- [ ] External audit of the contract
- [ ] 7 days on staging with no unexplained failed payouts
- [ ] Daily backups with a *tested* restore
- [ ] Per-token cap starting at 500 USDC
- [ ] Error tracking and an alert channel wired up

---

## Related

| | |
|---|---|
| **Contract** | [Soroban-escrow/escrow-contracts](https://github.com/Soroban-escrow/escrow-contracts) — the escrow itself, in Rust |
| **Testnet deployment** | [`CCEKBPYC…ZF3J4RKN`](https://stellar.expert/explorer/testnet/contract/CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V) |
| **Architecture** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Running it in anger** | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| **GitHub App setup** | [`docs/GITHUB_APP.md`](docs/GITHUB_APP.md) |
| **Build log** | [`docs/PROGRESS.md`](docs/PROGRESS.md) |

### Built with

Node 26 · TypeScript (strict) · Fastify 5 · Prisma 7 · PostgreSQL 18 · BullMQ 6 · Redis 8 ·
Next.js 16 · React 19 · Stellar SDK 16 · Vitest · Playwright
