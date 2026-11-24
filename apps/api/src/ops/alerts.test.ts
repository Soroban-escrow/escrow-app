import { describe, expect, it, vi } from 'vitest';
import { collectAlerts } from './alerts.js';

describe('collectAlerts (#156)', () => {
  it('includes runbook links for every alert condition', async () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const db = {
      payout: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async () => [{ status: 'PENDING_WALLET', bounty: { id: 42n, deadline: now } }]),
      },
      indexerCursor: {
        findUnique: vi.fn(async () => ({ id: 'bounty_escrow', ledger: 1000 })),
      },
      dispute: {
        count: vi.fn(async () => 1),
      },
    };

    const alerts = await collectAlerts({
      db: db as never,
      now: () => now,
      relayerBalanceXlm: 12.5,
      minRelayerXlm: 50,
      latestLedger: 1100,
    });

    expect(alerts).toHaveLength(5);
    expect(alerts[0]).toContain('#alert-relayer-balance-low');
    expect(alerts[1]).toContain('#alert-payouts-failed');
    expect(alerts[2]).toContain('#alert-indexer-lag');
    expect(alerts[3]).toContain('#alert-disputes-overdue');
    expect(alerts[4]).toContain('#alert-refund-window-near');
  });
});
