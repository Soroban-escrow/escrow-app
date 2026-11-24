import { loadConfig } from '../config.js';
import { buildServer } from '../server.js';
import { documentedRoutes } from './openapi.js';

const cfg = loadConfig({
  DATABASE_URL: 'postgresql://unused',
  BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  GITHUB_WEBHOOK_SECRET: 'hooksecret',
  LOG_LEVEL: 'silent',
});
const db = {} as never;
const app = await buildServer(cfg, { insert: async () => true, remove: async () => {}, enqueue: async () => {} }, {
  db,
  csrfSecret: cfg.CSRF_SECRET,
  login: {
    db, clientId: 'client', clientSecret: 'secret', callbackUrl: 'https://api.example/auth/callback',
    webUrl: 'https://app.example', secret: cfg.SESSION_SECRET, adminGithubIds: [],
  },
  chain: {
    buildFundTx: async () => '', buildReleaseTx: async () => '', buildRefundTx: async () => '',
    submitSigned: async () => '', getBounty: async () => ({ status: 'Open' }),
    buildOpenDisputeTx: async () => '', buildResolveTx: async () => '',
  },
});

await app.ready();
const registered = app.printRoutes({ commonPrefix: false }).split('\n').flatMap((line) => {
  const match = /^\s*[├└]──\s+(\S+)\s+\(([^)]+)\)/.exec(line);
  if (!match) return [];
  const [, path, methods] = match as [string, string, string];
  return methods.split(',').map((m) => m.trim()).filter((m) => m !== 'HEAD').map((method) => `${method} ${path}`);
}).sort();
await app.close();

const expected = documentedRoutes.map((r) => `${r.method} ${r.path}`).sort();
const missing = expected.filter((r) => !registered.includes(r));
const stale = registered.filter((r) => !expected.includes(r));
if (missing.length || stale.length) {
  console.error('OpenAPI document is stale.');
  if (missing.length) console.error(`Undocumented routes: ${missing.join(', ')}`);
  if (stale.length) console.error(`Removed routes still documented: ${stale.join(', ')}`);
  process.exitCode = 1;
} else console.log(`OpenAPI document matches all ${registered.length} registered routes`);
