/**
 * `/bounty` command metadata (#135): the single source for the bot's help
 * reply, the web docs page and the README table.
 *
 * This module has no runtime relative imports, so the Next.js app can import
 * `@skillescrow/shared/src/command-help` directly (Turbopack does not map the
 * `.js` specifiers used elsewhere in this package to their `.ts` sources).
 */
import type { Command } from './command.js';

/** Default bounty duration in days when `/bounty` gives none. */
export const DEFAULT_DAYS = 14;

/** Who may run a command. */
export type CommandAudience = 'writers' | 'maintainer-or-pr-author' | 'anyone';

/** One `/bounty` command, described once for the bot's help reply, the docs page and the README (#135). */
export interface CommandInfo {
  /** The parsed `Command['kind']` this entry documents. */
  kind: Exclude<Command['kind'], 'error'>;
  /** Usage, e.g. `/bounty <amount> [USDC|XLM] [<days>d]`. */
  syntax: string;
  /** A concrete command that parses to `kind`. */
  example: string;
  /** What it does, one sentence. */
  description: string;
  /** Who may run it. */
  audience: CommandAudience;
  /** Where it can be posted. */
  where: 'issue' | 'pull request' | 'issue or pull request';
}

/** Human labels for {@link CommandAudience}. */
export const AUDIENCE_LABEL: Record<CommandAudience, string> = {
  writers: 'Collaborators with write access',
  'maintainer-or-pr-author': 'The bounty maintainer or an author of a linked PR',
  anyone: 'Anyone',
};

/** Every `/bounty` command, in the order help lists them. The single source for all command help. */
export const COMMANDS: readonly CommandInfo[] = [
  {
    kind: 'fund',
    syntax: '/bounty <amount> [USDC|XLM] [<days>d]',
    example: `/bounty 50 USDC ${DEFAULT_DAYS}d`,
    description: `Fund this issue. The bot replies with a funding link; the token defaults to USDC and the duration to ${DEFAULT_DAYS} days.`,
    audience: 'writers',
    where: 'issue',
  },
  {
    kind: 'dispute',
    syntax: '/bounty dispute <reason>',
    example: '/bounty dispute the merged PR does not meet the criteria',
    description: 'Flag a problem on a bountied issue for a human arbiter.',
    audience: 'maintainer-or-pr-author',
    where: 'issue',
  },
  {
    kind: 'review',
    syntax: '/bounty review',
    example: '/bounty review',
    description: 'Queue a fresh AI review of this pull request against the bounty criteria.',
    audience: 'writers',
    where: 'pull request',
  },
  {
    kind: 'help',
    syntax: '/bounty help',
    example: '/bounty help',
    description: 'List these commands.',
    audience: 'anyone',
    where: 'issue or pull request',
  },
];

/** Human labels for {@link CommandInfo.where}. */
export const WHERE_LABEL: Record<CommandInfo['where'], string> = {
  issue: 'an issue',
  'pull request': 'a pull request',
  'issue or pull request': 'an issue or pull request',
};

/** The bot's help reply, rendered from {@link COMMANDS} as GitHub Markdown. */
export function formatCommandHelp(commands: readonly CommandInfo[] = COMMANDS): string {
  return [
    '**SkillEscrow commands**',
    ...commands.map((c) => {
      const example = c.example === c.syntax ? '' : ` Example: \`${c.example}\`.`;
      return `- \`${c.syntax}\`: ${c.description}${example} Who: ${AUDIENCE_LABEL[c.audience]}, on ${WHERE_LABEL[c.where]}.`;
    }),
  ].join('\n');
}

/**
 * The command reference as a Markdown table, for the README. A test checks
 * that the README contains exactly this text, so it cannot drift either.
 */
export function formatCommandTable(commands: readonly CommandInfo[] = COMMANDS): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|');
  return [
    '| Command | What it does | Who and where |',
    '|---|---|---|',
    ...commands.map((c) => {
      const example = c.example === c.syntax ? '' : ` e.g. \`${cell(c.example)}\``;
      return `| \`${cell(c.syntax)}\`${example} | ${cell(c.description)} | ${AUDIENCE_LABEL[c.audience]}, on ${WHERE_LABEL[c.where]} |`;
    }),
  ].join('\n');
}
