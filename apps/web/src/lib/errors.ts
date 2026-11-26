import { Errors as ContractErrors } from '@skillescrow/contract-client';

type ContractErrorName = (typeof ContractErrors)[keyof typeof ContractErrors]['message'];

/** A missing or misspelled contract error becomes a compile-time error. */
export const CONTRACT_ERROR_TEXT: Record<ContractErrorName, string> = {
  AlreadyInitialized: 'This escrow has already been initialized.',
  NotInitialized: 'The escrow is not ready yet. Contact the maintainer.',
  Unauthorized: 'This wallet is not allowed to perform that action.',
  Paused: 'Funding is paused right now. Try again later.',
  TokenNotAllowed: 'This token is not accepted. Choose an allowed token.',
  AmountTooSmall: 'The amount is below the minimum. Increase it and try again.',
  AmountTooLarge: 'The amount is above the maximum. Reduce it and try again.',
  InvalidDeadline: 'Choose a deadline within the allowed duration.',
  IssueAlreadyFunded: 'This issue already has an active bounty.',
  BountyNotFound: 'This bounty could not be found. Refresh the page and try again.',
  InvalidStatus: 'This bounty is no longer in a state that allows this action.',
  DeadlineNotReached: 'The refund window has not opened yet. Wait until the deadline and grace period pass.',
  SelfPayout: 'The maintainer cannot receive their own bounty payout. Choose another contributor.',
  InvalidSplit: 'The payout split is invalid. Use a percentage from 0 to 100%.',
  InvalidFee: 'The configured fee is invalid. Contact the escrow administrator.',
  Overflow: 'The amount is too large to process. Try a smaller amount.',
  RelayerNotAllowed: 'Automatic release is switched off for this bounty; the maintainer needs to sign it.',
};

const APP_TEXT: Record<string, string> = {
  not_requester: 'This link was created by another GitHub user.',
  intent_expired: 'This funding link has expired. Comment /bounty again on the issue.',
  intent_used: 'This bounty is already funded.',
  not_maintainer: 'Connect the wallet that funded this bounty.',
  unauthenticated: 'Sign in first.',
};
const numericErrors = new Map<number, ContractErrorName>(Object.entries(ContractErrors).map(([number, error]) => [Number(number), error.message as ContractErrorName]));
const loggedUnknown = new Set<string>();

export function errorText(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const numeric = /Error\(Contract,\s*#(\d+)\)/i.exec(code)?.[1];
  const name = numeric ? numericErrors.get(Number(numeric)) : code.startsWith('contract_') ? code.slice('contract_'.length) : undefined;
  if (name && Object.hasOwn(CONTRACT_ERROR_TEXT, name)) return CONTRACT_ERROR_TEXT[name as ContractErrorName]!;
  if (code in APP_TEXT) return APP_TEXT[code]!;
  if (process.env.NODE_ENV === 'development' && !loggedUnknown.has(code)) {
    loggedUnknown.add(code);
    console.warn(`Unmapped escrow error code: ${code}`);
  }
  return fallback;
}
