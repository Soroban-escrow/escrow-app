/** User-facing text for API error codes (contract errors arrive as contract_<Name>). */
const TEXT: Record<string, string> = {
  contract_Paused: 'Funding is paused right now. Try again later.',
  contract_TokenNotAllowed: 'This token is not accepted by the escrow.',
  contract_AmountTooSmall: 'The amount is below the minimum.',
  contract_AmountTooLarge: 'The amount is above the maximum allowed.',
  contract_InvalidDeadline: 'The deadline is outside the allowed range.',
  contract_IssueAlreadyFunded: 'This issue already has an active bounty.',
  contract_DeadlineNotReached: 'The refund window has not opened yet.',
  contract_InvalidStatus: 'This bounty is no longer open.',
  not_requester: 'This link was created by another GitHub user.',
  intent_expired: 'This funding link has expired. Comment /bounty again on the issue.',
  intent_used: 'This bounty is already funded.',
  not_maintainer: 'Connect the wallet that funded this bounty.',
  unauthenticated: 'Sign in first.',
};
export const errorText = (code: string | undefined, fallback: string) => (code && TEXT[code]) || fallback;
