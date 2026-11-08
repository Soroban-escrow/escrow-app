# Architecture

```
GitHub ──webhook──▶ API (Fastify) ──▶ Postgres ◀── indexer ◀── Stellar RPC events ◀── bounty_escrow contract
                        │                                         ▲
                        └── /bounties, wallet, /me (Next.js web)  └── relayer release (signed by relayer key)
```

- **Chain is the source of truth for money.** The DB is a cache rebuilt from contract events (`apps/api/src/indexer`). Payout code re-reads the chain before every decision.
- **AI is advisory.** `src/ai/` is never imported by `payouts/` or `chain/` (enforced by a test).
- **Status changes come only from the indexer.** Handlers create intents, PR links and payouts; bounty status follows chain events.

## Modules (`apps/api/src`)
`chain` wrapper over the generated client · `indexer` decode/apply/poll · `payouts` merge-to-payout state machine and relayer job (behind ports) · `github` webhook signature, `/bounty` commands, PR tracking, criteria, card · `auth` sessions, CSRF, SEP-53 wallet linking · `ai` prompt, schema, review, ranking, Anthropic adapter · `routes` HTTP API · `apps/web` Next.js pages.

## Pinned versions
Rust 1.99.1, soroban-sdk 29.0.1, stellar CLI 28.1.0, Node 26.13, pnpm 12.16.1, Prisma 7.10.1 (npm `latest` is an 8.0 RC), @stellar/stellar-sdk 16.4.1 (matches the generated client), Next 16, React 19.

## Contract Errors & Compile-Time Safety
Contract errors (codes 1-17) are generated from the contract spec into `@skillescrow/contract-client`. `apps/web/src/lib/errors.ts` enforces exhaustiveness using `Record<ContractErrorName, string>`, so adding a new error to the contract requires user-facing text and fails `pnpm typecheck` if omitted. Raw numeric formats (e.g. `Error(Contract, #13)`) are mapped to the same text.


## Not built yet
BullMQ queue and worker process, the real relayer signer and GitHub comment/label client, GitHub OAuth login, funding page and tx build/submit endpoints, dispute/admin pages, observability. See PROGRESS.md.
