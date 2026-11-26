-- Bind submitted funding transactions to their intents. The indexer matches on the tx hash
-- first, so two equal-amount intents cannot be swapped by the fuzzy (repo/issue/amount/token) match.

-- CreateTable
CREATE TABLE "FundingSubmission" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundingSubmission_txHash_key" ON "FundingSubmission"("txHash");

-- CreateIndex
CREATE INDEX "FundingSubmission_intentId_idx" ON "FundingSubmission"("intentId");

-- AddForeignKey
ALTER TABLE "FundingSubmission" ADD CONSTRAINT "FundingSubmission_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "FundingIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
