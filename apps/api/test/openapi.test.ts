import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openApiDocument } from '../src/routes/openapi.js';
import { buildServer } from '../src/server.js';

const cfg = loadConfig({
  DATABASE_URL: 'postgresql://unused',
  BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  GITHUB_WEBHOOK_SECRET: 'hooksecret',
  LOG_LEVEL: 'silent',
});

describe('openapi', () => {
  it('serves an OpenAPI 3.1 document generated from the route schemas', async () => {
    const app = await buildServer(cfg, { insert: async () => true, remove: async () => {}, enqueue: async () => {} });
    const r = await app.inject('/openapi.json');
    expect(r.statusCode).toBe(200);
    const doc = r.json() as typeof openApiDocument;
    expect(doc).toEqual(openApiDocument);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/bounties']).toBeDefined();
    expect(doc.paths['/wallet/challenge']).toBeDefined();
    expect(doc.paths['/admin/status']).toBeDefined();

    type BodyOperation = { requestBody?: { content: { 'application/json': { schema: { properties?: Record<string, unknown> } } } } };
    const challenge = doc.paths['/wallet/challenge']?.post as BodyOperation | undefined;
    expect(challenge?.requestBody?.content['application/json'].schema.properties?.address).toEqual({ type: 'string' });
  });
});
