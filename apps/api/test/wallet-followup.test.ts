import { describe, expect, it, vi } from 'vitest';
import { scheduleWalletFollowUp } from '../src/routes/wallet-followup.js';

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
};

describe('wallet link payout follow-up', () => {
  it('schedules the task outside the current tick', async () => {
    let calls = 0;
    const schedule = vi.fn((task: () => void) => setImmediate(task));
    scheduleWalletFollowUp(async () => { calls++; }, { schedule });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(calls).toBe(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
  });

  it('retries a failure with backoff and logs it', async () => {
    let calls = 0;
    const log = vi.fn();
    const delayMs = vi.fn(() => 0);
    scheduleWalletFollowUp(async () => { if (++calls === 1) throw new Error('rpc down'); }, {
      log, delayMs, schedule: (task) => setImmediate(task),
    });
    await waitFor(() => calls === 2);
    expect(delayMs).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith('wallet link payout follow-up failed, retrying', { attempt: 1, error: 'rpc down' });
    expect(log).not.toHaveBeenCalledWith('wallet link payout follow-up failed after retries', expect.anything());
  });

  it('stops after the configured attempts and logs exhaustion', async () => {
    let calls = 0;
    const log = vi.fn();
    scheduleWalletFollowUp(async () => { calls++; throw new Error('still down'); }, {
      attempts: 3, delayMs: () => 0, log, schedule: (task) => setImmediate(task),
    });
    await waitFor(() => calls === 3);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenLastCalledWith('wallet link payout follow-up failed after retries', { attempt: 3, error: 'still down' });
  });
});
