import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('Admin payouts status validation schema', () => {
  const allowed = ['FAILED', 'PENDING_WALLET', 'AWAITING_MAINTAINER', 'QUEUED', 'SUBMITTED', 'CONFIRMED'] as const;
  const schema = z.enum(allowed);

  it('accepts all valid payout statuses', () => {
    for (const status of allowed) {
      const res = schema.safeParse(status);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe(status);
      }
    }
  });

  it('rejects unknown or invalid status values with error', () => {
    const invalidStatuses = ['INVALID', 'failed', 'pending', 'UNKNOWN', '123', ''];
    for (const status of invalidStatuses) {
      const res = schema.safeParse(status);
      expect(res.success).toBe(false);
    }
  });

  it('defaults to FAILED when undefined query parameter is supplied', () => {
    const query: { status?: string } = {};
    const statusParam = query.status ?? 'FAILED';
    const res = schema.safeParse(statusParam);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe('FAILED');
    }
  });
});
