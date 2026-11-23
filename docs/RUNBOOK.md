# Runbook
- **Pause funding:** admin calls `pause`. Refund and resolve keep working.
- **Re-index:** For a full rebuild from chain events, run `pnpm reindex --from-ledger <N> --yes` (requires `--yes`; clears `Dispute`, `Payout`, `PullRequestBounty`, `Bounty`, and `IndexerCursor`, then replays events from ledger `N`). For a quick incremental restart from the retained window, delete the `IndexerCursor` row. Replays are safe (events are idempotent).
- **Retry a payout:** only when its stored tx hash is confirmed absent on chain; otherwise let the job check the hash.
- **Relayer key:** testnet from env; mainnet must be KMS/HSM. The relayer holds only XLM for fees and can only release opted-in bounties, bounded by the per-token max.
- **Restore DB:** daily backups with a tested restore are required before mainnet (not set up).

## Running the processes
- API: `pnpm --filter @skillescrow/api dev` (needs Postgres, Redis). Worker: `pnpm --filter @skillescrow/api worker` (indexer, webhook consumer, relayer when `RELAYER_SECRET` is set, alerts, reminders).
- Alerts go to `ALERT_WEBHOOK_URL` (once per message per hour).
- Health probes (API):
  - `GET /livez` is **liveness**. It checks the process only (always 200 while the server is up) and is not rate limited. Use it for restart decisions; an RPC blip or a lagging indexer must never restart a healthy API.
  - `GET /readyz` is **readiness**. It runs the dependency checks and returns 503 when the DB, RPC or Redis is down or the indexer is over 60 ledgers behind. Use it for traffic routing and alerting, never for restarts.
  - `GET /health` is kept as an alias of `/readyz` for existing monitors.
  - `render.yaml` defines only the worker, which serves no HTTP, so it has no health check path. If the API is ever run as a Render web service, set `healthCheckPath: /livez`.
- Retry a failed payout from the admin page only when no tx hash is stored; otherwise verify the hash on chain first.
- Web: `API_INTERNAL_URL` is baked in at `next build`; rebuild when it changes.

## Recovering missed GitHub webhooks
1. **Redeliver individual failed deliveries:**
   - Open the GitHub App settings -> **Advanced** -> **Recent Deliveries**.
   - Filter for failed (`4xx`/`5xx`) deliveries during the outage window and click **Redeliver**.
   - Redelivering is safe and idempotent: `WebhookDelivery` deduplicates by delivery ID (`X-GitHub-Delivery`).
2. **When to run the backfill instead:**
   - Run `pnpm --filter @skillescrow/api sync:installations` (implemented in `apps/api/src/github/backfill.ts`) when the outage exceeded GitHub's delivery retention window or when `installation` / `repository` events were missed in bulk.
3. **Confirm recovery:**
   - Query `SELECT count(*) FROM "WebhookDelivery" WHERE "processedAt" IS NULL OR error IS NOT NULL;` to verify no backlog remains.
   - Confirm `GET /health` returns HTTP `200` and newly added installations/repos appear in the `Installation` and `Repo` tables.

## Rotating the relayer key
1. **Drain in-flight `SUBMITTED` payouts first:**
   - Check for in-flight submissions: `SELECT id, "bountyId", "txHash" FROM "Payout" WHERE status = 'SUBMITTED';`.
   - Wait for the relayer loop to settle all `SUBMITTED` rows (count reaches `0`), or verify any lingering `txHash` on-chain before proceeding.
2. **Provision and fund the new relayer account:**
   - Generate a new Stellar keypair, fund it with XLM above `RELAYER_MIN_XLM_ALERT`, and register/authorize the new public key on the contract if required.
3. **Update `RELAYER_SECRET` and restart:**
   - Update `RELAYER_SECRET` in the worker environment and restart the worker process (`pnpm --filter @skillescrow/api worker`).
   - Verify worker logs show clean startup, `GET /health` returns `200`, and no `Relayer balance low` alert fires.
4. **Mainnet notes:**
   - `config.ts` rejects `RELAYER_SECRET` when `STELLAR_NETWORK=mainnet`. Mainnet deployments must use a KMS/HSM-backed signer and rotate the KMS key alias/version instead of an environment secret.

## Alerts

### <a id="alert-relayer-balance-low"></a>`Relayer balance low: <X> XLM (alert below <min>)`
- **What it means:** The relayer account's XLM fee balance dropped below `RELAYER_MIN_XLM_ALERT`.
- **Likely causes:** High payout volume depleting XLM fees, or `RELAYER_MIN_XLM_ALERT` threshold raised without topping up the account.
- **First actions:** Fund the relayer's Stellar address with XLM and verify the updated balance in Stellar Explorer / RPC.
- **When to escalate:** If balance drops unexpectedly fast (possible stuck retry loop or unauthorized usage), pause payouts and escalate to engineering.

### <a id="alert-payouts-failed"></a>`<N> payout(s) FAILED and need attention`
- **What it means:** One or more `Payout` rows are in `FAILED` status and will not retry automatically.
- **Likely causes:** Expired/invalid transaction, RPC outage, relayer sequence mismatch, or contract rejection.
- **First actions:** Inspect `lastError` and `txHash` in `/admin` or the `Payout` table. Confirm on-chain whether `txHash` already landed; only retry if absent on-chain.
- **When to escalate:** If multiple payouts fail with contract errors (`InvalidStatus`, authorization errors) or repeated RPC errors.

### <a id="alert-indexer-lag"></a>`Indexer is <N> ledgers behind`
- **What it means:** `latestLedger - IndexerCursor.ledger > 60` (~5 minutes behind chain tip).
- **Likely causes:** Worker process stopped/crashed, Stellar RPC rate limiting or downtime, or cursor fell outside RPC retention.
- **First actions:** Check worker logs and RPC health (`GET /health`). Restart the worker if stopped; if the cursor is outside retention, the indexer replays from the last stored ledger and alerts with the skipped ledger gap (see below).
- **When to escalate:** If lag continues growing despite a healthy worker and reachable RPC.

### <a id="alert-indexer-retention-gap"></a>`Indexer skipped <N> ledger(s) (<from> → <to>) outside RPC retention`
- **What it means:** The stored cursor and its ledger are both older than the RPC's retained window, so events in that range are missing from the DB cache. An `indexer.retention_gap` audit-log entry records the exact gap.
- **Likely causes:** Worker/RPC downtime longer than the RPC retention window, or a cursor left untouched for too long.
- **First actions:** Run `pnpm reindex --from-ledger <from>` from the `from` ledger in the alert to rebuild the cache from events. Verify the indexer cursor ledger catches up to the chain tip.
- **When to escalate:** If the gap contains bounty state changes that cannot be replayed (RPC no longer retains them) or if reindex cannot recover the range.

### <a id="alert-disputes-overdue"></a>`<N> dispute(s) older than 36 h`
- **What it means:** One or more disputes in `requested` or `opened_onchain` state have been open for over 36 hours.
- **Likely causes:** Arbiter backlog, missing evidence from maintainer/contributor, or stalled on-chain `resolve` transaction.
- **First actions:** Review open disputes in `/admin`, inspect linked PRs/evidence, and notify the assigned arbiter.
- **When to escalate:** If the bounty deadline/refund window is approaching or the arbiter is unreachable.

### <a id="alert-refund-window-near"></a>`Bounty <id> has a merged PR (<status>) and its refund window is near`
- **What it means:** A bounty still `OPEN` on-chain has a merged PR with an unsettled payout (`PENDING_WALLET`, `AWAITING_MAINTAINER`, or `FAILED`) and its deadline is within 72 hours.
- **Likely causes:** Winner has not linked a Stellar wallet (`PENDING_WALLET`), maintainer has not signed a non-relayer release (`AWAITING_MAINTAINER`), or payout failed.
- **First actions:** Contact the contributor/maintainer (or check why relayer payout failed) so release completes before the maintainer can refund.
- **When to escalate:** Within 24 hours of deadline expiry if the contributor or maintainer is unresponsive and arbiter intervention is needed.
