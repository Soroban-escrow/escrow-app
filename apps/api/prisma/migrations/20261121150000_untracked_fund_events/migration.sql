-- Keep funded events whose repo is not installed yet, so a late installation can replay them.
CREATE TABLE "UntrackedFundEvent" (
    "id" BIGINT NOT NULL,
    "repoId" BIGINT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UntrackedFundEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UntrackedFundEvent_repoId_idx" ON "UntrackedFundEvent"("repoId");
