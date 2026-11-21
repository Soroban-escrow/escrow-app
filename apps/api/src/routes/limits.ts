import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { COOKIE } from '../auth/session.js';
import { parseCookies } from './cookies.js';

/** Rate-limit key: the signed-in session when there is one (per user), otherwise the IP. */
export function userKey(req: FastifyRequest): string {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  return sid && /^[0-9a-f]{64}$/.test(sid)
    ? `u:${createHash('sha256').update(sid).digest('hex').slice(0, 16)}`
    : `ip:${req.ip}`;
}

export const mutationLimit = (max = 20) => ({ config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: userKey } } });
