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
