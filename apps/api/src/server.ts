import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { verifySignature } from './github/signature.js';
import { registerApi, type ApiDeps } from './routes/api.js';

/** Minimal storage the webhook route needs; the real one is Prisma, tests pass a fake. */
export interface DeliveryStore {
  /** returns false if the delivery id was already seen */
  insert(id: string, event: string): Promise<boolean>;
  enqueue(id: string, event: string, payload: unknown): Promise<void>;
  rollback?(id: string): Promise<void>;
}

export async function buildServer(cfg: Config, store: DeliveryStore, api?: ApiDeps, health?: () => Promise<{ ok: boolean }>): Promise<FastifyInstance> {
  // trustProxy makes req.ip the real client (from X-Forwarded-For) rather than the proxy, which the global and
  // anonymous rate limits key on. Without it every user behind Render/Vercel shares one limit.
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    logger: { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // keep the raw body for signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.url.startsWith('/github/webhooks')) return done(null, body);
    if ((body as Buffer).length === 0) return done(null, undefined);
    try { done(null, JSON.parse((body as Buffer).toString('utf8'))); } catch { done(Object.assign(new Error('invalid JSON'), { statusCode: 400 }), undefined); }
  });

  // Liveness: the process is up and serving. Checks no dependencies, so a slow RPC or lagging indexer never gets a healthy API restarted.
  // Exempt from the global rate limit: a 429 on a liveness probe would look like a dead process.
  app.get('/livez', { config: { rateLimit: false } }, async () => ({ ok: true }));

  // Readiness: the dependency checks (db, RPC, Redis, indexer lag). 503 means "do not route traffic", not "restart".
  const readiness = async (_req: FastifyRequest, reply: FastifyReply) => {
    const h = health ? await health() : { ok: true };
    return reply.code(h.ok ? 200 : 503).send(h);
  };
  app.get('/readyz', readiness);
  // Kept for existing monitors and docs; same as /readyz.
  app.get('/health', readiness);
  if (api) registerApi(app, api);

  app.post('/github/webhooks', async (req, reply) => {
    const raw = req.body as Buffer;
    if (!verifySignature(cfg.GITHUB_WEBHOOK_SECRET, raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      return reply.code(401).send({ error: { code: 'bad_signature', message: 'invalid signature' } });
    }
    const id = req.headers['x-github-delivery'];
    const event = req.headers['x-github-event'];
    if (typeof id !== 'string' || typeof event !== 'string') {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'missing delivery headers' } });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: { code: 'bad_json', message: 'invalid JSON' } });
    }
    if (!(await store.insert(id, event))) return reply.code(200).send({ duplicate: true });
    try {
      await store.enqueue(id, event, payload);
    } catch (err) {
      if (store.rollback) {
        await store.rollback(id);
      }
      return reply.code(500).send({ error: { code: 'enqueue_failed', message: 'failed to enqueue webhook delivery' } });
    }
    return reply.code(202).send({ queued: true });
  });

  return app;
}
