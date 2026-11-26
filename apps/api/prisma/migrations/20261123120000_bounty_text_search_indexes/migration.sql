CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Bounty_issueTitle_idx" ON "Bounty" USING GIN ("issueTitle" gin_trgm_ops);
CREATE INDEX "Repo_fullName_idx" ON "Repo" USING GIN ("fullName" gin_trgm_ops);
