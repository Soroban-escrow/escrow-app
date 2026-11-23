export const BOUNTY_STATUSES = ['OPEN', 'RELEASED', 'REFUNDED', 'DISPUTED', 'RESOLVED'] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];
const set: ReadonlyMap<string, BountyStatus> = new Map(BOUNTY_STATUSES.map((s) => [s, s]));
export const parseStatus = (s: string): BountyStatus | undefined => set.get(s);
