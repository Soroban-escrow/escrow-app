# Lookup index query plans

The migration `20261123120000_lookup_indexes` adds seven btree indexes used by the
queries below. The plans are representative of the query shapes in `apps/api/src`
before and after the migration; run the `EXPLAIN` statements against a migrated
database to reproduce the measured plans in your environment.

## Issue #116

### `/me/funded` — `Bounty.maintainer` (`src/routes/api.ts`)

```sql
EXPLAIN SELECT id, "issueTitle" FROM "Bounty" WHERE maintainer = 'GABC…' ORDER BY id DESC;
```

Before: `Seq Scan on "Bounty"` with a filter on `maintainer`, followed by `Sort`.
After: `Index Scan using "Bounty_maintainer_idx" on "Bounty"` (the sort is over the
much smaller set of rows for that maintainer).

### Reminder / announcement dedupe — `AuditLog(action, target)` (`src/ops/reminders.ts`, `src/github/sync.ts`)

```sql
EXPLAIN SELECT id FROM "AuditLog" WHERE action = 'reminder.refund_soon' AND target = 'bounty:123';
```

Before: `Seq Scan on "AuditLog"` (the table has no indexes at all).
After: `Index Scan using "AuditLog_action_target_idx" on "AuditLog"`.

### Review caps — `AiReview.createdAt` (`src/ai/pipeline.ts`)

```sql
EXPLAIN SELECT count(*) FROM "AiReview" WHERE "createdAt" >= now() - interval '30 days';
```

Before: `Aggregate` over `Seq Scan on "AiReview"`.
After: `Aggregate` over `Index Only Scan using "AiReview_createdAt_idx"` (after vacuum).

## Issue #117

### Admin payout list — `Payout(status, updatedAt)` (`src/routes/admin.ts`)

```sql
EXPLAIN SELECT * FROM "Payout" WHERE status = 'FAILED' ORDER BY "updatedAt" DESC LIMIT 100;
```

Before: `Limit` → `Sort` → `Seq Scan on "Payout"`.
After: `Limit` → `Index Scan backward using "Payout_status_updatedAt_idx"`; no sort.

### Earnings / profile — `Payout(winnerGithubId)` (`src/routes/api.ts`)

```sql
EXPLAIN SELECT * FROM "Payout" WHERE "winnerGithubId" = 123 ORDER BY "createdAt" DESC;
```

Before: `Sort` → `Seq Scan on "Payout"`.
After: `Index Scan using "Payout_winnerGithubId_idx"` with a sort only over that
winner's rows.

### Stale dispute alerts — `Dispute(status, createdAt)` (`src/ops/alerts.ts`, `src/routes/admin.ts`)

```sql
EXPLAIN SELECT * FROM "Dispute" WHERE status IN ('requested', 'opened_onchain') ORDER BY "createdAt" ASC;
```

Before: `Sort` → `Seq Scan on "Dispute"`.
After: per-status `Index Scan using "Dispute_status_createdAt_idx"`, merged in
`createdAt` order. The pre-existing `Dispute_status_idx` is retained for queries
that filter on `status` alone.

### Indexer dispute lookups — `Dispute(bountyId)` (`src/indexer/apply.ts`)

```sql
EXPLAIN SELECT * FROM "Dispute" WHERE "bountyId" = 42 AND status = 'requested';
```

Before: `Seq Scan on "Dispute"` (foreign keys are not indexed automatically).
After: `Index Scan using "Dispute_bountyId_idx" on "Dispute"`.
