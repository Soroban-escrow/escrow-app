const GITHUB = 'https://github.com/';

/** Shared prefix so a repo rename can re-base stored issue URLs with the same format the indexer uses. */
export const issueUrlPrefix = (repoFullName: string): string => `${GITHUB}${repoFullName}/issues/`;

/** Canonical issue URL for a bounty. Derived from the repo's current full name. */
export const issueUrl = (repoFullName: string, issueNumber: number): string =>
  `${issueUrlPrefix(repoFullName)}${issueNumber}`;
