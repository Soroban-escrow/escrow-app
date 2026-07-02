# Security review (self-review, incomplete)
Done: webhook HMAC on raw body, constant-time; delivery dedupe; session ids hashed; CSRF on mutations; SEP-53 single-use challenges with atomic burn; chain re-read before payouts; AI isolated from payout code; untrusted text escaped in comments; prompt data tagged and defanged; no secrets in repo.
Open: contract has had no external audit; admin can upgrade code (needs multisig before mainnet); relayer key custody; rate limits only on a few routes; no secret scanning or dependency audit in CI yet; OAuth flow unwritten; per-user rate limits missing.
