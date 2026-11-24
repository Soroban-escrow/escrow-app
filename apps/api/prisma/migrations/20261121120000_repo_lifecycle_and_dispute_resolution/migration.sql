-- Track removed repositories without deleting rows bounties point at.
ALTER TABLE "Repo" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Remember who opened a dispute so a rejection can @mention them on GitHub.
ALTER TABLE "Dispute" ADD COLUMN "openedByLogin" TEXT;

-- A resolution is only a proposal until the indexer sees the matching on-chain event.
ALTER TABLE "Dispute" ADD COLUMN "pendingWinner" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "pendingWinnerBps" INTEGER;
ALTER TABLE "Dispute" ADD COLUMN "pendingNote" TEXT;

CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");
