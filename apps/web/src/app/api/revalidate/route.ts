import { revalidateTag } from 'next/cache';
import { invalidateCacheTag, verifyRevalidateRequest } from '@/lib/api';

interface RevalidateBody {
  tag?: string;
  tags?: string[];
  bountyId?: string | number;
}

function triggerNextRevalidateTag(tag: string): void {
  try {
    const rt = revalidateTag as (t: string, profile?: string) => void;
    rt(tag, 'max');
  } catch {
    // Outside Next.js request context (e.g. direct unit test invocation); in-memory tag invalidation still applies.
  }
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET ?? '';
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-revalidate-signature');
  const timestampHeader = req.headers.get('x-revalidate-timestamp');

  const check = verifyRevalidateRequest({
    secret,
    rawBody,
    signatureHeader,
    timestampHeader,
  });

  if (!check.ok) {
    return Response.json({ error: check.error }, { status: check.status });
  }

  let parsed: RevalidateBody;
  try {
    parsed = (rawBody ? JSON.parse(rawBody) : {}) as RevalidateBody;
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  const tagSet = new Set<string>();
  if (typeof parsed.tag === 'string' && parsed.tag.trim()) {
    tagSet.add(parsed.tag.trim());
  }
  if (Array.isArray(parsed.tags)) {
    for (const t of parsed.tags) {
      if (typeof t === 'string' && t.trim()) tagSet.add(t.trim());
    }
  }
  if (parsed.bountyId !== undefined && parsed.bountyId !== null && String(parsed.bountyId).trim() !== '') {
    tagSet.add('bounties');
    tagSet.add(`bounty:${String(parsed.bountyId).trim()}`);
  }

  if (tagSet.size === 0) {
    return Response.json({ error: 'at least one tag or bountyId is required' }, { status: 400 });
  }

  const tags = [...tagSet];
  for (const tag of tags) {
    invalidateCacheTag(tag);
    triggerNextRevalidateTag(tag);
  }

  return Response.json({ revalidated: true, tags });
}
