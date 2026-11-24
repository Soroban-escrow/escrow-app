import { pathToFileURL } from 'node:url';
import type { Db } from '../db.js';
import { createDb } from '../db.js';
import { loadConfig, loadDotEnv } from '../config.js';
import { createChain } from '../chain/client.js';
import { pollOnce, type IndexerDeps } from './indexer.js';

export interface ReindexCliArgs {
  fromLedger: number;
  yes: boolean;
}

/**
 * Parses CLI arguments for the reindex command:
 *   pnpm reindex --from-ledger <N> --yes
 */
export function parseReindexArgs(argv: string[]): ReindexCliArgs {
  let fromLedger: number | undefined;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--from-ledger') {
      const raw = argv[i + 1];
      if (!raw || !/^\d+$/.test(raw)) {
        throw new Error('--from-ledger requires a non-negative integer ledger sequence');
      }
      fromLedger = Number(raw);
      i += 1;
    } else if (arg.startsWith('--from-ledger=')) {
      const raw = arg.slice('--from-ledger='.length);
      if (!/^\d+$/.test(raw)) {
        throw new Error('--from-ledger requires a non-negative integer ledger sequence');
      }
      fromLedger = Number(raw);
    }
  }

  if (!yes) {
    throw new Error('Refusing to reset indexer tables without --yes confirmation flag');
  }
  if (fromLedger === undefined || !Number.isSafeInteger(fromLedger) || fromLedger < 0) {
    throw new Error('--from-ledger <N> is required');
  }

  return { fromLedger, yes };
}

/**
 * Resets indexer-derived tables and the cursor in FK-safe order, then replays
 * chain events starting at `fromLedger` until caught up.
 */
export async function reindexFromLedger(
  deps: IndexerDeps,
  options: ReindexCliArgs,
): Promise<{ eventsReplayed: number; batches: number }> {
  if (!options.yes) {
    throw new Error('Refusing to reset indexer tables without --yes confirmation flag');
  }

  await deps.db.$transaction(async (tx) => {
    await tx.dispute.deleteMany();
    await tx.payout.deleteMany();
    await tx.pullRequestBounty.deleteMany();
    await tx.bounty.deleteMany();
    await tx.indexerCursor.deleteMany();
  });

  let eventsReplayed = 0;
  let batches = 0;
  while (true) {
    const beforeCursor = await deps.db.indexerCursor.findFirst();
    const seen = await pollOnce(deps, options.fromLedger);
    eventsReplayed += seen;
    batches += 1;
    const afterCursor = await deps.db.indexerCursor.findFirst();
    if (seen === 0 && afterCursor?.cursor === beforeCursor?.cursor) {
      break;
    }
    if (batches >= 1000) {
      break;
    }
  }

  return { eventsReplayed, batches };
}

async function main() {
  const args = parseReindexArgs(process.argv.slice(2));
  loadDotEnv();
  const cfg = loadConfig();
  const db: Db = createDb(cfg.DATABASE_URL);
  const chain = createChain({
    rpcUrl: cfg.STELLAR_RPC_URL,
    networkPassphrase: cfg.STELLAR_NETWORK_PASSPHRASE,
    contractId: cfg.BOUNTY_CONTRACT_ID,
  });

  try {
    const result = await reindexFromLedger(
      {
        db,
        server: chain.server,
        contractId: cfg.BOUNTY_CONTRACT_ID,
        log: (msg, extra) => console.log(JSON.stringify({ msg, extra })),
      },
      args,
    );
    console.log(JSON.stringify({ ok: true, fromLedger: args.fromLedger, ...result }));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
