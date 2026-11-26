-- PR states were free strings; map the three existing values onto a Postgres enum.
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

ALTER TABLE "PullRequest" ALTER COLUMN "state" TYPE "PullRequestState"
  USING CASE "state"
    WHEN 'open' THEN 'OPEN'
    WHEN 'closed' THEN 'CLOSED'
    WHEN 'merged' THEN 'MERGED'
  END::"PullRequestState";
