import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { net } from '@skillescrow/shared';
import { createChallenge, unlinkWallet, verifyChallenge, WalletError } from '../auth/wallet.js';
import type { IssueCommenter } from '../ops/reminders.js';
import { COOKIE, csrfToken, csrfValid, destroySession, destroyAllSessions, getSessionUser, renewSessionIfNeeded } from '../auth/session.js';
import { parseCookies } from '../auth/cookies.js';
import { clearSessionCookie, clearStateCookie, finishLogin, LoginError, OAUTH_COOKIE, sessionCookie, startLogin, stateCookie, type LoginDeps } from '../auth/github-login.js';
import type { Db } from '../db.js';
import { mutationLimit as limit } from './limits.js';
import { registerAdmin, type AdminChain } from './admin.js';
import { registerFunding, type FundingChain } from './funding.js';
import { err, ser, type Authed } from './http.js';
import { scheduleWalletFollowUp, type RetryOptions } from './wallet-followup.js';

export interface ApiDeps {
  db: Db;
  csrfSecret: string;
  /** GitHub user ids with admin rights, derived from current config (not the login-time snapshot). */
  adminGithubIds?: bigint[];
  /** called after a wallet is linked (continues pending payouts) */
  onWalletLinked?: (githubId: bigint) => Promise<unknown>;
  /** retry policy for the background payout follow-up after a wallet link */
  walletFollowUpRetry?: RetryOptions;
  /** enables the funding, release and refund routes */
  chain?: FundingChain & AdminChain & {
    getConfig?: () => Promise<{ fee_bps: number; grace_secs: bigint; min_duration_secs: bigint; max_duration_secs: bigint }>;
    getTokenLimits?: (token: string) => Promise<{ min_amount: bigint; max_amount: bigint } | null>;
  };
  tokens?: Array<{ address: string; symbol: string; decimals: number }>;
  /** enables GitHub sign-in (/auth/login, /auth/callback) */
  login?: LoginDeps;
  /** posts admin dispute decisions back to the issue; failures are retried by the worker */
  commenter?: IssueCommenter;
}

export const walletBodySchema = z.object({ address: z.string() });
export const verifyBodySchema = z.object({ challengeId: z.string(), signature: z.string() });
export const listQuerySchema = z.object({
  status: z.enum(['OPEN', 'RELEASED', 'REFUNDED', 'DISPUTED', 'RESOLVED', 'ALL']).optional(),
  token: z.string().optional(),
  repo: z.string().max(200).optional(),
  minAmount: z.string().regex(/^\d+$/).optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['newest', 'highest', 'ending']).default('newest'),
  cursor: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function registerApi(app: FastifyInstance, d: ApiDeps) {
  const cookies = (req: FastifyRequest) => parseCookies(req.headers.cookie);
  const secure = d.login?.callbackUrl.startsWith('https://') ?? false;

  async function requireUser(req: Authed, reply: FastifyReply, mutating: boolean) {
    const sid = cookies(req)[COOKIE];
    const user = await getSessionUser(d.db, sid);
    if (!user || !sid) return err(reply, 401, 'unauthenticated', 'sign in first');
    if (mutating && !csrfValid(d.csrfSecret, sid, req.headers['x-csrf-token'])) return err(reply, 403, 'csrf', 'missing or invalid CSRF token');
    req.user = user;
    req.sessionId = sid;
    // sliding renewal: extend the session when less than half its lifetime remains
    const newMaxAge = await renewSessionIfNeeded(d.db, sid);
    if (newMaxAge) reply.header('set-cookie', sessionCookie(sid, newMaxAge, secure));
    return undefined;
  }
  const authed = (mutating: boolean) => ({
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => requireUser(req as Authed, reply, mutating),
  });
  const mutationLimit = limit(20);

  if (d.login) {
    const login = d.login;
    app.get('/auth/login', async (req, reply) => {
      const { url, cookie } = startLogin(login, (req.query as { next?: string }).next);
      return reply.header('set-cookie', stateCookie(cookie, secure)).redirect(url);
    });
    app.get('/auth/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      try {
        const r = await finishLogin(login, req.query as { code?: string; state?: string }, cookies(req)[OAUTH_COOKIE]);
        return reply.header('set-cookie', [sessionCookie(r.sessionId, r.maxAgeSeconds, secure), clearStateCookie]).redirect(r.redirect);
      } catch (e) {
        if (e instanceof LoginError) return reply.header('set-cookie', clearStateCookie).code(e.status).send({ error: { code: e.code, message: e.message } });
        throw e;
      }
    });
  }

  app.get('/auth/me', authed(false), async (req) => {
    const u = (req as Authed).user!;
    const isAdmin = d.adminGithubIds ? d.adminGithubIds.includes(u.githubId) : u.isAdmin;
    return { id: u.id, login: u.githubLogin, avatarUrl: u.avatarUrl, wallet: u.wallet, isAdmin, csrfToken: csrfToken(d.csrfSecret, (req as Authed).sessionId!) };
  });

  app.post('/auth/logout', authed(true), async (req, reply) => {
    await destroySession(d.db, (req as Authed).sessionId!);
    return reply.header('set-cookie', clearSessionCookie(secure)).send({ ok: true });
  });

  app.post('/auth/logout-all', authed(true), async (req, reply) => {
    await destroyAllSessions(d.db, (req as Authed).user!.id);
    return reply.header('set-cookie', clearSessionCookie(secure)).send({ ok: true });
  });

  app.post('/wallet/challenge', { ...authed(true), ...mutationLimit }, async (req, reply) => {
    const body = walletBodySchema.safeParse(req.body);
    if (!body.success) return err(reply, 400, 'bad_request', 'address required');
    try {
      return await createChallenge({ db: d.db }, (req as Authed).user!.id, body.data.address);
    } catch (e) {
      if (e instanceof WalletError) return err(reply, e.status, e.code, e.message);
      throw e;
    }
  });
  app.post('/wallet/verify', { ...authed(true), ...mutationLimit }, async (req, reply) => {
    const body = verifyBodySchema.safeParse(req.body);
    if (!body.success) return err(reply, 400, 'bad_request', 'challengeId and signature required');
    const u = (req as Authed).user!;
    let result: Awaited<ReturnType<typeof verifyChallenge>>;
    try {
      result = await verifyChallenge({ db: d.db }, u.id, body.data.challengeId, body.data.signature);
    } catch (e) {
      if (e instanceof WalletError) return err(reply, e.status, e.code, e.message);
      throw e;
    }
    if (d.onWalletLinked) {
      const onWalletLinked = d.onWalletLinked;
      scheduleWalletFollowUp(() => onWalletLinked(u.githubId), {
        ...d.walletFollowUpRetry,
        log: (message, extra) => app.log.error({ extra }, message),
      });
    }
    return result;
  });
  app.delete('/wallet', authed(true), async (req) => {
    await unlinkWallet({ db: d.db }, (req as Authed).user!.id);
    return { ok: true };
  });

  if (d.chain) {
    registerFunding(app, { db: d.db, chain: d.chain }, authed);
    registerAdmin(app, { db: d.db, chain: d.chain, commenter: d.commenter, adminGithubIds: d.adminGithubIds ?? [] }, authed);
  }

  // ---- public reads ----
  app.get('/config', async (_req, reply) => {
    try {
      const config = await d.chain?.getConfig?.();
      const tokens = await Promise.all((d.tokens ?? []).map(async (token) => {
        const limits = await d.chain?.getTokenLimits?.(token.address);
        return { ...token, minAmount: limits?.min_amount.toString() ?? null, maxAmount: limits?.max_amount.toString() ?? null };
      }));
      return ser({ feeBps: config?.fee_bps ?? null, graceSecs: config?.grace_secs ?? null, minDurationSecs: config?.min_duration_secs ?? null, maxDurationSecs: config?.max_duration_secs ?? null, tokens });
    } catch {
      return err(reply, 503, 'config_unavailable', 'escrow configuration is temporarily unavailable');
    }
  });

  app.get('/filters', async () => {
    const [repos, tokens] = await Promise.all([
      d.db.repo.findMany({ where: { bounties: { some: {} } }, select: { fullName: true }, orderBy: { fullName: 'asc' } }),
      d.db.bounty.findMany({ distinct: ['token'], select: { token: true }, orderBy: { token: 'asc' } }),
    ]);
    return { statuses: ['OPEN', 'RELEASED', 'REFUNDED', 'DISPUTED'], tokens: tokens.map((x) => x.token), repositories: repos.map((x) => x.fullName) };
 feat/bounty-metadata-ai-accessibility
  });

  const listQuery = z.object({
    status: z.enum(['OPEN', 'RELEASED', 'REFUNDED', 'DISPUTED', 'RESOLVED', 'ALL']).optional(),
    token: z.string().optional(),
    repo: z.string().max(200).optional(),
    minAmount: z.string().regex(/^\d+$/).optional(),
    q: z.string().max(100).optional(),
    sort: z.enum(['newest', 'highest', 'ending']).default('newest'),
    cursor: z.string().regex(/^\d{1,18}$/).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),

 fresh-build
  });

  app.get('/bounties', async (req, reply) => {
    const p = listQuerySchema.safeParse(req.query);
    if (!p.success) return err(reply, 400, 'bad_request', 'invalid query');
    const f = p.data;
    const rows = await d.db.bounty.findMany({
      where: {
        ...(f.status && f.status !== 'ALL' ? { status: f.status } : f.status === 'ALL' ? {} : { status: 'OPEN' }),
        ...(f.token ? { token: f.token } : {}),
        ...(f.repo ? { repo: { fullName: f.repo } } : {}),
        ...(f.minAmount ? { amount: { gte: f.minAmount } } : {}),
        ...(f.q ? { OR: [{ issueTitle: { contains: f.q, mode: 'insensitive' as const } }, { repo: { fullName: { contains: f.q, mode: 'insensitive' as const } } }] } : {}),
      },
      orderBy: f.sort === 'highest' ? [{ amount: 'desc' }, { id: 'desc' }] : f.sort === 'ending' ? [{ deadline: 'asc' }, { id: 'desc' }] : [{ id: 'desc' }],
      include: { repo: { select: { fullName: true } }, _count: { select: { prs: true } } },
      take: f.limit + 1,
      ...(f.cursor ? { skip: 1, cursor: { id: BigInt(f.cursor) } } : {}),
    });
    const items = rows.slice(0, f.limit);
    return ser({ items, nextCursor: rows.length > f.limit ? items.at(-1)?.id : null });
  });

  app.get('/bounties/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^\d{1,18}$/.test(id)) return err(reply, 404, 'not_found', 'bounty not found');
    const b = await d.db.bounty.findUnique({
      where: { id: BigInt(id) },
      include: { repo: { select: { fullName: true } }, prs: { include: { pr: { include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } } } } }, payouts: true },
    });
    if (!b) return err(reply, 404, 'not_found', 'bounty not found');
    return ser({ ...b, prs: b.prs.map((l) => l.pr) }); // the API keeps returning a flat PR list
  });

  app.post('/bounties/:id/dispute', { ...authed(true), ...mutationLimit }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^\d{1,18}$/.test(id)) return err(reply, 404, 'not_found', 'bounty not found');
    const body = z.object({ reason: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    if (!body.success) return err(reply, 400, 'bad_request', 'a reason is required');
    const u = (req as Authed).user!;
    const bounty = await d.db.bounty.findUnique({ where: { id: BigInt(id) }, include: { prs: { include: { pr: true } } } });
    if (!bounty) return err(reply, 404, 'not_found', 'bounty not found');
    const contributor = bounty.prs.some((link) => link.pr.authorGithubId === u.githubId);
    if (bounty.maintainerGithubId !== u.githubId && !contributor) return err(reply, 403, 'forbidden', 'only the maintainer or a linked contributor can request a dispute');
    if (!['OPEN', 'DISPUTED'].includes(bounty.status)) return err(reply, 409, 'wrong_state', 'this bounty is no longer disputable');
    const existing = await d.db.dispute.findFirst({ where: { bountyId: bounty.id, status: { in: ['requested', 'opened_onchain'] } } });
    if (existing) return err(reply, 409, 'already_requested', 'a dispute is already being reviewed');
    const dispute = await d.db.dispute.create({ data: { bountyId: bounty.id, openedByGithubId: u.githubId, reason: body.data.reason, evidence: {}, status: 'requested' } });
    await d.db.auditLog.create({ data: { actor: `github:${u.githubId}`, action: 'dispute.requested', target: `bounty:${bounty.id}`, data: { source: 'web' } } });
    return { id: dispute.id, status: dispute.status };
  });

  app.get('/me/earnings', authed(false), async (req) => {
    const u = (req as Authed).user!;
    return ser(await d.db.payout.findMany({
      where: { winnerGithubId: u.githubId },
      include: { bounty: { select: { token: true, amount: true, feeBps: true, issueTitle: true } } },
      orderBy: { createdAt: 'desc' },
    }));
  });
  app.get('/me/funded', authed(false), async (req) => {
    const u = (req as Authed).user!;
    if (!u.wallet) return [];
    return ser(await d.db.bounty.findMany({ where: { maintainer: u.wallet }, orderBy: { id: 'desc' } }));
  });

  app.get('/users/:login', async (req, reply) => {
    const u = await d.db.user.findFirst({ where: { githubLogin: { equals: (req.params as { login: string }).login, mode: 'insensitive' } } });
    if (!u) return err(reply, 404, 'not_found', 'user not found');
    const paid = await d.db.payout.findMany({
      where: { winnerGithubId: u.githubId, status: 'CONFIRMED' },
      include: { bounty: { select: { id: true, token: true, amount: true, feeBps: true, issueTitle: true, issueUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const earned = new Map<string, bigint>();
    for (const p of paid) {
      earned.set(p.bounty.token, (earned.get(p.bounty.token) ?? 0n) + net(BigInt(p.bounty.amount), p.bounty.feeBps));
    }
    return ser({
      login: u.githubLogin,
      avatarUrl: u.avatarUrl,
      paid: paid.map((p) => ({ bounty: p.bounty, txHash: p.txHash })),
      earnedByToken: [...earned].map(([token, amount]) => ({ token, amount })),
      paidCount: paid.length,
      firstPayoutAt: paid.length ? paid.reduce((first, p) => p.createdAt < first ? p.createdAt : first, paid[0]!.createdAt) : null,
    });
  });
}
