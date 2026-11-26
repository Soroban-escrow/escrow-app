-- Dispute statuses were free strings; map the four existing values onto a Postgres enum.
CREATE TYPE "DisputeStatus" AS ENUM ('REQUESTED', 'OPENED_ONCHAIN', 'REJECTED', 'RESOLVED');

ALTER TABLE "Dispute" ALTER COLUMN "status" TYPE "DisputeStatus"
  USING CASE "status"
    WHEN 'requested' THEN 'REQUESTED'
    WHEN 'opened_onchain' THEN 'OPENED_ONCHAIN'
    WHEN 'rejected' THEN 'REJECTED'
    WHEN 'resolved' THEN 'RESOLVED'
  END::"DisputeStatus";
