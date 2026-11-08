import {
  type ContractErrorName,
  CONTRACT_ERROR_NAMES,
  CONTRACT_ERROR_NUMBERS,
} from '@skillescrow/contract-client';

export type AppErrorCode =
  | 'not_requester'
  | 'intent_expired'
  | 'intent_used'
  | 'not_maintainer'
  | 'unauthenticated';

export type ContractErrorCode = `contract_${ContractErrorName}`;

export type KnownErrorCode = ContractErrorCode | AppErrorCode;

/**
 * Strict mapping of contract error names to user-facing messages.
 * Typed as Record<ContractErrorName, string> so that any added or missing
 * contract error from the generated contract client forces a TypeScript compile error.
 */
export const CONTRACT_ERROR_TEXT: Record<ContractErrorName, string> = {
  AlreadyInitialized: 'This escrow contract has already been initialized.',
  NotInitialized: 'The escrow contract has not been initialized yet. Contact support.',
  Unauthorized: 'You do not have authorization to perform this action with your connected wallet.',
  Paused: 'Funding is currently paused by the administrator. Please try again later.',
  TokenNotAllowed: 'This token is not on the allowed list for the escrow contract.',
  AmountTooSmall: 'The funding amount is below the minimum required for this token.',
  AmountTooLarge: 'The funding amount exceeds the maximum limit allowed for this token.',
  InvalidDeadline: 'The chosen deadline is outside the permitted duration limits.',
  IssueAlreadyFunded: 'This GitHub issue already has an active funded bounty.',
  BountyNotFound: 'The requested bounty was not found on-chain. Please verify the bounty ID.',
  InvalidStatus: 'This bounty is no longer open for the requested operation.',
  DeadlineNotReached: 'The refund window has not opened yet; the deadline must elapse first.',
  SelfPayout: 'You cannot release a bounty payout to your own wallet address.',
  InvalidSplit: 'The dispute payout split percentages must total exactly 100%.',
  InvalidFee: 'The configured protocol fee basis points are outside the allowable range.',
  Overflow: 'The transaction could not be processed because a calculation exceeded arithmetic bounds.',
  RelayerNotAllowed: 'Automatic release is switched off for this bounty; the maintainer needs to sign it.',
};

export const APP_ERROR_TEXT: Record<AppErrorCode, string> = {
  not_requester: 'This funding link was created by another GitHub user.',
  intent_expired: 'This funding link has expired. Comment /bounty again on the issue.',
  intent_used: 'This bounty is already funded.',
  not_maintainer: 'Connect the repository maintainer wallet that funded this bounty.',
  unauthenticated: 'Please sign in first.',
};

/**
 * User-facing text for API error codes (contract errors arrive as contract_<Name> or bare <Name>, plus app codes).
 */
export const TEXT: Record<ContractErrorCode, string> & Record<AppErrorCode, string> & Record<ContractErrorName, string> = {
  ...APP_ERROR_TEXT,
  ...CONTRACT_ERROR_TEXT,
  ...(Object.entries(CONTRACT_ERROR_TEXT).reduce((acc, [name, msg]) => {
    acc[`contract_${name as ContractErrorName}`] = msg;
    return acc;
  }, {} as Record<ContractErrorCode, string>)),
};

const loggedUnknownCodes = new Set<string>();

/** Reset logged unknown codes set (primarily for testing verification). */
export function _resetLoggedUnknownCodes(): void {
  loggedUnknownCodes.clear();
}

/**
 * Maps an API error code or raw contract error (named or numeric) to user-facing text.
 * Falls back to `fallback` if the error code is unrecognized, logging unknown codes
 * once to console.warn in non-production environments.
 */
export function errorText(code: string | undefined | null, fallback: string): string {
  if (!code) {
    return fallback;
  }

  const direct = TEXT[code as keyof typeof TEXT];
  if (direct) {
    return direct;
  }

  const match = code.match(/(?:Error\(Contract,\s*#?|contract_|^#?)(\d+)\)?/i);
  if (match && match[1]) {
    const num = Number(match[1]);
    const name = CONTRACT_ERROR_NAMES[num];
    if (name) {
      const text = CONTRACT_ERROR_TEXT[name];
      if (text) {
        return text;
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    if (!loggedUnknownCodes.has(code)) {
      loggedUnknownCodes.add(code);
      console.warn(`[errors] Unknown error code received: "${code}". Falling back to: "${fallback}"`);
    }
  }

  return fallback;
}

export { CONTRACT_ERROR_NAMES, CONTRACT_ERROR_NUMBERS };
