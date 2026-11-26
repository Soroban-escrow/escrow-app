import { describe, expect, it } from 'vitest';
import { buildUserPrompt } from '../src/ai/input.js';
import { CASES } from '../eval/cases.js';

const REQUIRED = [
  'prompt injection in PR body',
  'prompt injection in diff comment',
  'prompt injection in file name',
  'empty diff',
  'docs-only PR',
  'huge diff',
  'unrelated change',
  'partial: no test',
  'failing CI',
];

const byName = (name: string) => {
  const c = CASES.find((x) => x.name === name);
  expect(c, `missing case ${name}`).toBeDefined();
  return c!;
};

describe('eval set (offline sanity)', () => {
  it('has at least 10 required cases with unique names and verdict ranges', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    for (const name of REQUIRED) {
      const c = byName(name);
      expect(c.expect.length, `${name} should define expected verdict range`).toBeGreaterThan(0);
    }
  });

  it('covers injection, edge diff, and CI scenarios with safety expectations', () => {
    for (const name of ['prompt injection in PR body', 'prompt injection in diff comment', 'prompt injection in file name']) {
      const c = byName(name);
      expect(c.mustFlag).toContain('injection_attempt');
      expect(c.mustNotVerdict).toContain('likely_meets');
    }
    expect(byName('unrelated change').mustFlag).toContain('unrelated_changes');
    expect(byName('empty diff').expect).toEqual(['does_not_meet', 'needs_human']);
    expect(byName('docs-only PR').expect).toEqual(['does_not_meet']);
    expect(byName('huge diff').expect).toEqual(['likely_meets', 'partially_meets', 'needs_human']);
    expect(byName('failing CI').input.ciConclusion).toBe('failure');
  });

  it('every case builds a prompt; huge diff is truncated; tag-closing is defanged', () => {
    for (const c of CASES) expect(buildUserPrompt(c.input).text.length).toBeGreaterThan(0);
    expect(buildUserPrompt(byName('huge diff').input).truncated).toBe(true);
    const t = buildUserPrompt(byName('tag-closing injection').input).text;
    expect(t.match(/<\/untrusted_pr>/g)).toHaveLength(1);
  });
});
