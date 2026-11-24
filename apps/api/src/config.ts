import { isIP } from 'node:net';
import { z } from 'zod';

/** Fastify's `trustProxy`: no proxy, a number of proxy hops, or a list of trusted proxy addresses/CIDRs. */
export type TrustProxy = false | number | string[];

const MAX_PROXY_HOPS = 10;
// Names understood by Fastify's proxy-addr: loopback, link-local and private ranges.
const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const TRUST_ALL = 'trusts every client-supplied X-Forwarded-For, so anyone can spoof their IP and dodge rate limits; use a hop count (such as 1) or the CIDR ranges of your proxies';

/** Problem with one trusted-proxy entry (IP, CIDR or keyword), or null if it is fine. */
function badProxyEntry(entry: string): string | null {
  if (PROXY_KEYWORDS.has(entry)) return null;
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return `"${entry}" is not an IP address, CIDR range or one of ${[...PROXY_KEYWORDS].join('/')}`;
  if (prefix === undefined) return null;
  if (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) return `"${entry}" has an invalid prefix length`;
  if (Number(prefix) === 0) return `"${entry}" ${TRUST_ALL}`;
  return null;
}

/**
 * Parse TRUST_PROXY. Unset, empty, "false" or "0" trust no proxy (req.ip is the socket address).
 * A number is how many proxy hops sit in front of the API; otherwise a comma/space separated list of
 * proxy IPs, CIDR ranges or keywords. "true" and /0 ranges are rejected because they trust everything.
 */
export function parseTrustProxy(raw: string): { ok: true; value: TrustProxy } | { ok: false; error: string } {
  const text = raw.trim().toLowerCase();
  if (text === '' || text === 'false') return { ok: true, value: false };
  if (text === 'true') return { ok: false, error: `"true" ${TRUST_ALL}` };
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops === 0) return { ok: true, value: false };
    if (hops > MAX_PROXY_HOPS) return { ok: false, error: `a hop count must be between 1 and ${MAX_PROXY_HOPS}` };
    return { ok: true, value: hops };
  }
  const entries = text.split(/[\s,]+/).filter(Boolean);
  for (const entry of entries) {
    const problem = badProxyEntry(entry);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, value: entries };
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  // Dedicated high-entropy token for Prometheus. Without it /metrics is disabled.
  METRICS_TOKEN: z.string().min(32).optional(),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet', 'local']).default('testnet'),
  STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  BOUNTY_CONTRACT_ID: z.string().regex(/^C[A-Z2-7]{55}$/),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  GITHUB_WEBHOOK_SECRET: z.string().min(8),
  // GitHub App (docs/GITHUB_APP.md). All optional until registered; all-or-none once any is set.
  GITHUB_APP_ID: z.string().regex(/^\d+$/).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().includes('PRIVATE KEY').optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  ADMIN_GITHUB_IDS: z.string().regex(/^\d+(,\d+)*$/).optional(),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_MAX_REVIEWS_PER_PR_PER_DAY: z.coerce.number().int().min(1).default(5),
  AI_MAX_REVIEWS_PER_REPO_PER_DAY: z.coerce.number().int().min(1).default(50),
  EXPLORER_TX_URL_TEMPLATE: z.string().default('https://stellar.expert/explorer/testnet/tx/{hash}'),
  RELAYER_SECRET: z.string().regex(/^S[A-Z2-7]{55}$/).optional(),
  RELAYER_MIN_XLM_ALERT: z.coerce.number().default(50),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  TOKEN_USDC_CONTRACT_ID: z.string().default(''),
  TOKEN_XLM_CONTRACT_ID: z.string().default(''),
  // Behind Render/Vercel/any proxy, req.ip is the proxy unless told how many hops (or which CIDRs) to trust.
  // Off by default: trusting X-Forwarded-For without a proxy in front lets clients pick their own IP.
  TRUST_PROXY: z.string().default('').transform((raw, ctx) => {
    const r = parseTrustProxy(raw);
    if (r.ok) return r.value;
    ctx.addIssue({ code: 'custom', message: r.error });
    return z.NEVER;
  }),
}).refine((c) => {
  const set = [c.GITHUB_APP_ID, c.GITHUB_APP_SLUG, c.GITHUB_APP_PRIVATE_KEY, c.GITHUB_CLIENT_ID, c.GITHUB_CLIENT_SECRET].filter(Boolean).length;
  return set === 0 || set === 5;
}, { message: 'set all five GitHub App variables (APP_ID, APP_SLUG, APP_PRIVATE_KEY, CLIENT_ID, CLIENT_SECRET) or none', path: ['GITHUB_APP_ID'] }).refine((c) => !(c.STELLAR_NETWORK === 'mainnet' && c.RELAYER_SECRET), {
  message: 'RELAYER_SECRET must not be used on mainnet; use a KMS-backed signer',
  path: ['RELAYER_SECRET'],
});

export type Config = z.infer<typeof schema>;

/** Loads apps/api/.env into process.env when present (real environment variables win). */
export function loadDotEnv(path = new URL('../.env', import.meta.url)) {
  try { process.loadEnvFile(path); } catch { /* no .env file: fine */ }
}

/** The only place that reads process.env's shape. Exits with a clear message when invalid. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return r.data;
}
