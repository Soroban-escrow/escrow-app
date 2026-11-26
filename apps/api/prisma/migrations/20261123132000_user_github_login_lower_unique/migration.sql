-- GitHub logins are case-insensitive. Retire duplicate logins left behind by account renames,
-- keeping the oldest row for each login, then enforce the rule in the database.
WITH duplicates AS (
  SELECT ctid, row_number() OVER (PARTITION BY lower("githubLogin") ORDER BY "id") AS rn
  FROM "User"
)
UPDATE "User" u
SET "githubLogin" = '@stale-' || u."githubId"::text
FROM duplicates d
WHERE u.ctid = d.ctid AND d.rn > 1;

CREATE UNIQUE INDEX "User_githubLogin_lower_key" ON "User" (lower("githubLogin"));
