-- Indexes for filtered lookups that currently scan their whole table:
-- /me/funded (Bounty.maintainer), reminder/announcement dedupe (AuditLog.action,
-- AuditLog.target), review caps (AiReview.createdAt), admin/relayer payout and
-- dispute listings, and dispute lookups by bounty.
CREATE INDEX "Bounty_maintainer_idx" ON "Bounty"("maintainer");
CREATE INDEX "AuditLog_action_target_idx" ON "AuditLog"("action", "target");
CREATE INDEX "AiReview_createdAt_idx" ON "AiReview"("createdAt");
CREATE INDEX "Payout_status_updatedAt_idx" ON "Payout"("status", "updatedAt");
CREATE INDEX "Payout_winnerGithubId_idx" ON "Payout"("winnerGithubId");
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_bountyId_idx" ON "Dispute"("bountyId");
