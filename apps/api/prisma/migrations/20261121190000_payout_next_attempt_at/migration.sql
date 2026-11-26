-- Persist the relayer backoff deadline so a restart/deploy does not retry every
-- backing-off payout at once against an RPC that may still be failing.
ALTER TABLE "Payout" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- Existing QUEUED/SUBMITTED rows have no recorded deadline and are due immediately.
-- New transient failures set this column; a successful relay leaves it NULL.

-- CreateIndex
CREATE INDEX "Payout_nextAttemptAt_idx" ON "Payout"("nextAttemptAt");
