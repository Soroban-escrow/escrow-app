# Runbook (draft)
- **Pause funding:** admin calls `pause`. Refund and resolve keep working.
- **Re-index:** delete the `IndexerCursor` row; the poller restarts from the retained window. Replays are safe (events are idempotent).
- **Retry a payout:** only when its stored tx hash is confirmed absent on chain; otherwise let the job check the hash.
- **Relayer key:** testnet from env; mainnet must be KMS/HSM. The relayer holds only XLM for fees and can only release opted-in bounties, bounded by the per-token max.
- **Restore DB:** daily backups with a tested restore are required before mainnet (not set up).
