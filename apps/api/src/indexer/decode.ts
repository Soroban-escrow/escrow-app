import { scValToNative, type xdr } from '@stellar/stellar-sdk';

export type ChainEvent =
  | { kind: 'funded'; id: bigint; maintainer: string; repoId: bigint; issue: bigint; token: string; amount: bigint; feeBps: number; deadline: bigint; relayerAllowed: boolean }
  | { kind: 'released'; id: bigint; winner: string; net: bigint; fee: bigint; caller: string }
  | { kind: 'refunded'; id: bigint; amount: bigint }
  | { kind: 'disputed'; id: bigint; caller: string }
  | { kind: 'resolved'; id: bigint; winner: string | null; winnerNet: bigint; fee: bigint; maintainerAmount: bigint };

export interface RawEvent {
  id: string;
  ledger: number;
  txHash: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

export function decodeEvent(raw: Pick<RawEvent, 'topic' | 'value'>): ChainEvent | null {
  try {
    if (!Array.isArray(raw.topic) || raw.value == null) return null;
    const topics = raw.topic.map((t) => scValToNative(t) as unknown);
    if (topics[0] !== 'bounty' || typeof topics[1] !== 'string') return null;
    const name = topics[1];
    if (!['funded', 'released', 'refunded', 'disputed', 'resolved'].includes(name)) return null;
    const id = topics[2];
    if (typeof id !== 'bigint') return null;
    const native = scValToNative(raw.value);
    if (native == null || typeof native !== 'object' || Array.isArray(native)) return null;
    const v = native as Record<string, unknown>;
    const big = (k: string): bigint => {
      const x = v[k];
      if (typeof x !== 'bigint') throw new Error(`event ${name}: field ${k} is not an integer`);
      return x;
    };
    const str = (k: string): string => {
      const x = v[k];
      if (typeof x !== 'string') throw new Error(`event ${name}: field ${k} is not a string`);
      return x;
    };
    switch (name) {
      case 'funded': {
        const feeBps = Number(v['fee_bps']);
        if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) return null;
        return {
          kind: 'funded', id, maintainer: str('maintainer'), repoId: big('repo_id'), issue: big('issue'),
          token: str('token'), amount: big('amount'), feeBps, deadline: big('deadline'),
          relayerAllowed: v['relayer_allowed'] === true,
        };
      }
      case 'released':
        return { kind: 'released', id, winner: str('winner'), net: big('net'), fee: big('fee'), caller: str('caller') };
      case 'refunded':
        return { kind: 'refunded', id, amount: big('amount') };
      case 'disputed':
        return { kind: 'disputed', id, caller: str('caller') };
      default:
        return {
          kind: 'resolved', id, winner: typeof v['winner'] === 'string' ? v['winner'] : null,
          winnerNet: big('winner_net'), fee: big('fee'), maintainerAmount: big('maintainer_amount'),
        };
    }
  } catch {
    return null;
  }
}
