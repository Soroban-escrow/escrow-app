import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getCookie } from '../auth/cookies.js';
import { COOKIE } from '../auth/session.js';

const SESSION_ID = /^[0-9a-f]{64}$/;

/**
 * Rate-limit key: the signed-in session when there is one (per user), otherwise the IP.
 * Reads the session cookie with the same parser as the API, so both agree on
 * which `se_session` a request carries.
 */
export function userKey(req: FastifyRequest): string {
  const sid = getCookie(req.headers.cookie, COOKIE);
  return sid && SESSION_ID.test(sid) ? `u:${createHash('sha256').update(sid).digest('hex').slice(0, 16)}` : `ip:${req.ip}`;
}

export const mutationLimit = (max = 20) => ({ config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: userKey } } });
