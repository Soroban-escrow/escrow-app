# Runbook (draft)
- **Pause funding:** admin calls `pause`. Refund and resolve keep working.
- **Re-index:** delete the `IndexerCursor` row; the poller restarts from the retained window. Replays are safe (events are idempotent).
- **Retry a payout:** only when its stored tx hash is confirmed absent on chain; otherwise let the job check the hash.
- **Relayer key:** testnet from env; mainnet must be KMS/HSM. The relayer holds only XLM for fees and can only release opted-in bounties, bounded by the per-token max.
- **Restore DB:** daily backups with a tested restore are required before mainnet (not set up).

## Running the processes
- API: `pnpm --filter @skillescrow/api dev` (needs Postgres, Redis). Worker: `pnpm --filter @skillescrow/api worker` (indexer, webhook consumer, relayer when `RELAYER_SECRET` is set, alerts, reminders).
- Alerts go to `ALERT_WEBHOOK_URL` (once per message per hour). `/health` returns 503 when the DB, RPC or Redis is down or the indexer is over 60 ledgers behind.
- Retry a failed payout from the admin page only when no tx hash is stored; otherwise verify the hash on chain first.
- Web: `API_INTERNAL_URL` is baked in at `next build`; rebuild when it changes.
- **Cache revalidation (`POST /api/revalidate`):** Public web reads use Next's Data Cache (`revalidate: 15` for `/bounties` and `/bounties/:id`, `revalidate: 60` for `/users/:login`, with tags `['bounties', 'bounty:<id>']` and `['users', 'user:<login>']`) plus a bounded 5-minute stale-while-revalidate fallback when the API is unreachable. When `REVALIDATE_SECRET` is set on both `apps/web` and `apps/api`, `applyEvent` (`apps/api/src/indexer/apply.ts`) and the worker send a signed request:
  - URL: `POST ${WEB_PUBLIC_URL}/api/revalidate`
  - Headers: `x-revalidate-timestamp: <unix_seconds>`, `x-revalidate-signature: sha256=<hmac_sha256(REVALIDATE_SECRET, "${timestamp}.${rawBody}")>`
  - Body: `{"bountyId":"<id>","tags":["bounties","bounty:<id>"]}`
  - Requests outside the 300-second replay window or with an invalid HMAC are rejected in constant time (`401`).
