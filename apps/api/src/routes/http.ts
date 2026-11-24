import type { FastifyReply, FastifyRequest } from 'fastify';
import { contractErrorName } from '../chain/errors.js';

export type Authed = FastifyRequest & {
  sessionId?: string;
  user?: {
    id: string;
    githubId: bigint;
    githubLogin: string;
    avatarUrl: string | null;
    wallet: string | null;
    isAdmin: boolean;
  };
};

export const err = (r: FastifyReply, status: number, code: string, message: string) =>
  r.code(status).send({ error: { code, message } });

export const ser = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

/** Turns a chain failure into a stable, user-facing error. */
export function chainError(r: FastifyReply, e: unknown) {
  const name = contractErrorName(e instanceof Error ? e.message : String(e));
  return err(r, 422, name ? `contract_${name}` : 'chain_error', name ? `The contract rejected this: ${name}` : 'The network rejected this request.');
}
