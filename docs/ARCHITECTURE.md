# Architecture

```
GitHub ──webhook──▶ API (Fastify) ──▶ Postgres ◀── worker (indexer + BullMQ + relayer + alerts/reminders) ◀── Stellar RPC ◀── bounty_escrow
                        │                                                                                      ▲
                        └── /bounties, /fund/[intentId], /me, /admin (Next.js web)                             └── relayer release (signed by relayer key)
```

- **Chain is the source of truth for money.** The DB is a cache rebuilt from contract events (`apps/api/src/indexer`). Payout code re-reads the chain before every decision.
- **AI is advisory.** `src/ai/` is never imported by `payouts/` or `chain/` (enforced by a test).
- **Status changes come only from the indexer.** Handlers create intents, PR links and payouts; bounty status follows chain events.

## Modules (`apps/api/src`)
`chain` wrapper over the generated client · `indexer` decode/apply/poll · `payouts` merge-to-payout state machine and relayer job (behind ports) · `github` webhook signature, `/bounty` commands, PR tracking, criteria, card sync, installation backfill · `auth` GitHub OAuth + sessions, CSRF, SEP-53 wallet linking · `ai` prompt, schema, review, ranking, Anthropic adapter · `worker` BullMQ webhook queue, `review-queue`, indexer/relayer loops · `ops` `alerts` and `reminders` · `routes` HTTP API (`/bounties`, `/fund`, `/admin`, `/auth`, `/health`) · `apps/web` Next.js pages.

## Pinned versions
Rust 1.99.1, soroban-sdk 29.0.1, stellar CLI 28.1.0, Node 26.13, pnpm 12.16.1, Prisma 7.10.1 (npm `latest` is an 8.0 RC), @stellar/stellar-sdk 16.4.1 (matches the generated client), Next 16, React 19.

## Remaining production-readiness items
All core application modules (BullMQ worker, review queue, relayer, GitHub OAuth & card sync, funding/admin pages, alerts, and reminders) are implemented. See [PROGRESS.md](PROGRESS.md) for remaining operational/human prerequisites (mainnet KMS signer, admin multisig, external audit, 7-day staging soak, tested DB restore, and live `ANTHROPIC_API_KEY` evaluation).
