import { backoffMs } from '../payouts/loop.js';

export interface RetryOptions {
  attempts?: number;
  delayMs?: (attempt: number) => number;
}

export interface FollowUpOptions extends RetryOptions {
  log?: (message: string, extra?: unknown) => void;
  schedule?: (task: () => void) => void;
}

const setImmediateTask = (task: () => void) => { setImmediate(task); };

/** Runs a wallet-link follow-up outside the request lifecycle and retries transient failures. */
export function scheduleWalletFollowUp(task: () => Promise<unknown>, options: FollowUpOptions = {}): void {
  const attempts = Math.max(1, options.attempts ?? 5);
  const delayMs = options.delayMs ?? backoffMs;
  const log = options.log ?? (() => {});
  const schedule = options.schedule ?? setImmediateTask;

  const run = async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await task();
        return;
      } catch (e) {
        const extra = { attempt, error: e instanceof Error ? e.message : String(e) };
        if (attempt === attempts) {
          log('wallet link payout follow-up failed after retries', extra);
          return;
        }
        log('wallet link payout follow-up failed, retrying', extra);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs(attempt)));
      }
    }
  };

  schedule(() => { void run(); });
}
