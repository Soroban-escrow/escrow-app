import { z, type ZodType } from 'zod';
import { arbiterAddressSchema, disputeRejectSchema, disputeResolveSchema, payoutQuerySchema } from './admin.js';
import { listQuerySchema, verifyBodySchema, walletBodySchema } from './api.js';
import { intentBuildSchema, txSubmitSchema } from './funding.js';

type Auth = 'public' | 'session' | 'session+csrf' | 'admin-read' | 'admin-write' | 'github-hmac';

export interface DocumentedRoute {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  summary: string;
  auth: Auth;
  body?: ZodType;
  query?: ZodType;
}

/** Every public/authenticated HTTP route, with the same zod schemas the handlers validate with. */
export const documentedRoutes: DocumentedRoute[] = [
  { method: 'GET', path: '/livez', summary: 'Liveness probe', auth: 'public' },
  { method: 'GET', path: '/readyz', summary: 'Readiness probe', auth: 'public' },
  { method: 'GET', path: '/health', summary: 'Readiness probe (legacy alias)', auth: 'public' },
  { method: 'GET', path: '/openapi.json', summary: 'This OpenAPI 3.1 document', auth: 'public' },
  { method: 'POST', path: '/github/webhooks', summary: 'Verified GitHub webhook delivery', auth: 'github-hmac' },
  { method: 'GET', path: '/auth/login', summary: 'Start GitHub sign-in', auth: 'public' },
  { method: 'GET', path: '/auth/callback', summary: 'Finish GitHub sign-in', auth: 'public' },
  { method: 'GET', path: '/auth/me', summary: 'Current user and CSRF token', auth: 'session' },
  { method: 'POST', path: '/auth/logout', summary: 'End this session', auth: 'session+csrf' },
  { method: 'POST', path: '/auth/logout-all', summary: 'End all sessions for the current user', auth: 'session+csrf' },
  { method: 'POST', path: '/wallet/challenge', summary: 'Create a wallet linking challenge', auth: 'session+csrf', body: walletBodySchema },
  { method: 'POST', path: '/wallet/verify', summary: 'Verify a wallet signature', auth: 'session+csrf', body: verifyBodySchema },
  { method: 'DELETE', path: '/wallet', summary: 'Unlink the wallet', auth: 'session+csrf' },
  { method: 'GET', path: '/config', summary: 'Contract fee, timing and token limits', auth: 'public' },
  { method: 'GET', path: '/filters', summary: 'Available bounty filter values', auth: 'public' },
  { method: 'GET', path: '/bounties', summary: 'List bounties', auth: 'public', query: listQuerySchema },
  { method: 'GET', path: '/bounties/:id', summary: 'Bounty detail', auth: 'public' },
  { method: 'GET', path: '/me/earnings', summary: 'Payouts earned by the current user', auth: 'session' },
  { method: 'GET', path: '/me/funded', summary: 'Bounties funded by the current user', auth: 'session' },
  { method: 'GET', path: '/users/:login', summary: 'Public contributor profile', auth: 'public' },
  { method: 'GET', path: '/intents/:id', summary: 'Funding link state', auth: 'public' },
  { method: 'POST', path: '/intents/:id/build', summary: 'Build a funding transaction', auth: 'session+csrf', body: intentBuildSchema },
  { method: 'POST', path: '/tx/submit', summary: 'Submit a signed transaction', auth: 'session+csrf', body: txSubmitSchema },
  { method: 'POST', path: '/bounties/:id/release/build', summary: 'Build a maintainer release transaction', auth: 'session+csrf' },
  { method: 'POST', path: '/bounties/:id/refund/build', summary: 'Build a maintainer refund transaction', auth: 'session+csrf' },
  { method: 'GET', path: '/admin/disputes', summary: 'Open disputes', auth: 'admin-read' },
  { method: 'POST', path: '/admin/disputes/:id/open-onchain', summary: 'Build a dispute opening transaction', auth: 'admin-write', body: arbiterAddressSchema },
  { method: 'POST', path: '/admin/disputes/:id/resolve/build', summary: 'Build a dispute resolution transaction', auth: 'admin-write', body: disputeResolveSchema },
  { method: 'POST', path: '/admin/disputes/:id/reject', summary: 'Reject a dispute request', auth: 'admin-write', body: disputeRejectSchema },
  { method: 'GET', path: '/admin/payouts', summary: 'Payouts in a given state', auth: 'admin-read', query: payoutQuerySchema },
  { method: 'POST', path: '/admin/payouts/:id/retry', summary: 'Retry a failed payout', auth: 'admin-write' },
  { method: 'GET', path: '/admin/status', summary: 'Indexer and payout status', auth: 'admin-read' },
];

type SecurityRequirement = Record<string, string[]>;
const securityFor: Record<Auth, SecurityRequirement[]> = {
  public: [],
  session: [{ session: [] }],
  'session+csrf': [{ session: [], csrf: [] }],
  'admin-read': [{ session: [] }],
  'admin-write': [{ session: [], csrf: [] }],
  'github-hmac': [{ githubHmac: [] }],
};

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'], additionalProperties: false } },
  required: ['error'],
  additionalProperties: false,
};

/** Request-side JSON Schema: defaults and coercion describe what callers may send, not what zod returns. */
function jsonSchema(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function parameters(route: DocumentedRoute): object[] {
  const path = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
    name: m[1]!, in: 'path', required: true, schema: { type: 'string' },
  }));
  if (!route.query) return path;
  const json = jsonSchema(route.query) as { properties?: Record<string, unknown>; required?: string[] };
  const query = Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name, in: 'query', required: json.required?.includes(name) ?? false, schema,
  }));
  return [...path, ...query];
}

function operation(route: DocumentedRoute): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: route.summary,
    responses: {
      '200': { description: 'Success' },
      '400': { description: 'Invalid request', content: { 'application/json': { schema: errorSchema } } },
      '401': { description: 'Missing or invalid credentials', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  if (securityFor[route.auth].length) op.security = securityFor[route.auth];
  const params = parameters(route);
  if (params.length) op.parameters = params;
  if (route.body) op.requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(route.body) } } };
  return op;
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of documentedRoutes) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const methods = paths[path] ?? {};
    methods[route.method.toLowerCase()] = operation(route);
    paths[path] = methods;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'SkillEscrow API', version: '1.0.0', description: 'Public and authenticated escrow API routes.' },
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'se_session' },
        csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
        githubHmac: { type: 'apiKey', in: 'header', name: 'x-hub-signature-256' },
      },
    },
  };
}

export const openApiDocument = buildOpenApiDocument();
