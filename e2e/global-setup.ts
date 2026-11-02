import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { E2E_DB } from './playwright.config.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Seeds a known dataset and real sessions (stored hashed, like production). Cookie values go to .sessions.json. */
export default async function setup() {
  const db = new pg.Client({ connectionString: E2E_DB });
  await db.connect();
  await db.query('TRUNCATE "AuditLog","Payout","Dispute","AiReview","PullRequest","Bounty","FundingIntent","Repo","Installation","Session","User" CASCADE');
  await db.query(`INSERT INTO "Installation"(id,"accountLogin","accountType") VALUES (1,'acme','Organization')`);
  await db.query(`INSERT INTO "Repo"(id,"installationId","fullName",private) VALUES (100,1,'acme/widgets',false),(101,1,'acme/gadgets',false)`);
  const bounty = (id: number, repo: number, issue: number, title: string, amount: string, days: number, crit: string[]) =>
    db.query(`INSERT INTO "Bounty"(id,"repoId","issueNumber","issueTitle","issueUrl",criteria,maintainer,token,amount,"feeBps",deadline,"relayerAllowed",status,"fundTx","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,'https://github.com/acme/x/issues/1',$5,'GMAINT','CUSDCE2E',$6,300,now()+($7||' days')::interval,true,'OPEN','tx',now(),now())`, [id, repo, issue, title, crit, amount, String(days)]);
  await bounty(1, 100, 7, 'Retry failed HTTP requests', '500000000', 5, ['Retries 3 times', 'Adds a unit test']);
  await bounty(2, 100, 8, 'Add dark mode', '1200000000', 20, []);
  await bounty(3, 101, 9, 'Fix flaky CI', '250000000', 2, ['CI is green 10 runs in a row']);
  await db.query(`INSERT INTO "PullRequest"(id,"bountyId",number,"authorGithubId","authorLogin","headSha",state) VALUES (500,1,3,77,'contrib','abc','open'),(501,1,4,78,'second','def','open')`);
  await db.query(`INSERT INTO "AiReview"(id,"prId","headSha",model,verdict,score,result,flags,"inputTokens","outputTokens") VALUES ('r1',500,'abc','m','likely_meets',88,'{}','{}',1,1),('r2',501,'def','m','partially_meets',55,'{}','{}',1,1)`);
  const mkUser = async (githubId: number, login: string, isAdmin: boolean) => {
    const u = await db.query(`INSERT INTO "User"(id,"githubId","githubLogin","isAdmin","updatedAt") VALUES ($1,$2,$3,$4,now()) RETURNING id`, [`u${githubId}`, githubId, login, isAdmin]);
    const sid = randomBytes(32).toString('hex');
    await db.query(`INSERT INTO "Session"(id,"userId","expiresAt") VALUES ($1,$2,now()+interval '1 day')`, [sha(sid), u.rows[0].id]);
    return sid;
  };
  const sessions = { user: await mkUser(55, 'maint', false), admin: await mkUser(1, 'boss', true) };
  const mkIntent = (id: string, expires: string, used: string | null) =>
    db.query(`INSERT INTO "FundingIntent"(id,"repoId","issueNumber","requestedBy",token,amount,"durationDays","commentId","expiresAt","usedAt") VALUES ($1,100,7,55,'CUSDCE2E',500000000,14,1,now()+($2||' hours')::interval,$3)`, [id, expires, used]);
  await mkIntent('intent-open-0000001', '12', null);
  await mkIntent('intent-expired-00001', '-1', null);
  await mkIntent('intent-used-0000001', '12', new Date().toISOString());
  await db.query(`INSERT INTO "Dispute"(id,"bountyId","openedByGithubId",reason,evidence,status,"createdAt","updatedAt") VALUES ('disputeaaaaaaaaaa1',3,55,'Merged PR was not paid','{}','requested',now()-interval '40 hours',now())`);
  await db.end();
  writeFileSync(new URL('./.sessions.json', import.meta.url), JSON.stringify(sessions));
}
