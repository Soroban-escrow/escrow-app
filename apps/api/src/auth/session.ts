import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';

export const COOKIE = 'se_session';
const DAYS = 30;
const SESSION_LIFETIME_MS = DAYS * 864e5;
const HALF_LIFETIME_MS = SESSION_LIFETIME_MS / 2;
const ONE_DAY_MS = 864e5;
export const SESSION_MAX_AGE_SECONDS = DAYS * 86400;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Session ids are stored hashed: a leaked table is not a set of logins. */
export async function createSession(db: Db, userId: string, now = new Date()) {
  const id = randomBytes(32).toString('hex');
  await db.session.create({ data: { id: hash(id), userId, expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) } });
  return { id, maxAgeSeconds: SESSION_MAX_AGE_SECONDS };
}

export async function getSessionUser(db: Db, id: string | undefined, now = new Date()) {
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const s = await db.session.findUnique({ where: { id: hash(id) }, include: { user: true } });
  if (!s || s.expiresAt <= now) return null;
  return s.user;
}

/**
 * Sliding renewal: extend expiresAt when less than half the lifetime remains,
 * at most once a day, so active sessions don't expire while idle.
 * Returns the new max-age in seconds if the session was renewed, or null otherwise.
 */
export async function renewSessionIfNeeded(db: Db, id: string | undefined, now = new Date()): Promise<number | null> {
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const s = await db.session.findUnique({ where: { id: hash(id) } });
  if (!s || s.expiresAt <= now) return null;
  const remaining = s.expiresAt.getTime() - now.getTime();
  const sinceCreated = now.getTime() - s.createdAt.getTime();
  if (remaining >= HALF_LIFETIME_MS || sinceCreated < ONE_DAY_MS) return null;
  await db.session.update({ where: { id: hash(id) }, data: { expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) } });
  return SESSION_MAX_AGE_SECONDS;
}

export const destroySession = (db: Db, id: string) => db.session.deleteMany({ where: { id: hash(id) } });

/** Delete all sessions for a user (sign out everywhere). */
export const destroyAllSessions = (db: Db, userId: string) => db.session.deleteMany({ where: { userId } });

export const csrfToken = (secret: string, sessionId: string) => createHmac('sha256', secret).update(sessionId).digest('hex');
export function csrfValid(secret: string, sessionId: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(csrfToken(secret, sessionId));
  return a.length === b.length && timingSafeEqual(a, b);
}
