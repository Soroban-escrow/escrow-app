import type { Db } from '../db.js';
import { applyEvent, decodeFundEvent } from './apply.js';

/**
 * Replay funded events we had to park because their repo was not installed yet. Called after a
 * repo upsert. Each event is applied and removed atomically so a crash never leaves it half-done.
 */
export async function replayUntrackedFunds(db: Db, repoId: bigint): Promise<number> {
  const rows = await db.untrackedFundEvent.findMany({ where: { repoId } });
  if (rows.length === 0) return 0;
  let replayed = 0;
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const { ev, meta } = decodeFundEvent(row.payload);
      const out = await applyEvent(tx, ev, meta);
      if (out === 'untracked') continue; // repo still not visible to this transaction; keep it
      await tx.untrackedFundEvent.delete({ where: { id: row.id } });
      if (out === 'applied') replayed++;
    }
  });
  return replayed;
}
