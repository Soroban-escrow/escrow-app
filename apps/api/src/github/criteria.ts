import { esc } from './card.js';

export const CRITERIA_CHANGED_ACTION = 'bounty.criteria_changed';

/** Acceptance criteria from an issue body (BUILD_SPEC 12.2). Empty list means "derive with AI". */
export function parseCriteria(body: string | null | undefined): string[] {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

  const h = lines.findIndex((l) => /^#{1,6}\s*acceptance criteria\s*:?\s*$/i.test(l.trim()));
  if (h >= 0) {
    const out: string[] = [];
    for (const l of lines.slice(h + 1)) {
      if (/^#{1,6}\s/.test(l)) break;
      const m = item.exec(l);
      if (m?.[1]) out.push(m[1]);
    }
    if (out.length) return out;
  }
  const boxes: string[] = [];
  for (const l of lines) {
    const m = /^\s*[-*+]\s+\[[ xX]\]\s+(.+?)\s*$/.exec(l);
    if (m?.[1]) boxes.push(m[1]);
  }
  return boxes;
}

/** Compares two criteria lists for element-wise equality. */
export function criteriaEqual(a?: string[] | null, b?: string[] | null): boolean {
  const listA = a ?? [];
  const listB = b ?? [];
  if (listA.length !== listB.length) return false;
  return listA.every((c, i) => c === listB[i]);
}

/** Returns true if the criteria lists differ. */
export function criteriaChanged(a?: string[] | null, b?: string[] | null): boolean {
  return !criteriaEqual(a, b);
}

/** Formats a comment to post on linked PRs when criteria change. */
export function formatCriteriaChangeComment(oldCriteria: string[], newCriteria: string[]): string {
  const lines = [
    'The acceptance criteria for this bounty have been updated.',
  ];
  if (oldCriteria.length) {
    lines.push('', '**Previous criteria:**', ...oldCriteria.map((x) => `- ${esc(x)}`));
  } else {
    lines.push('', '**Previous criteria:** _None_');
  }
  if (newCriteria.length) {
    lines.push('', '**New criteria:**', ...newCriteria.map((x) => `- ${esc(x)}`));
  } else {
    lines.push('', '**New criteria:** _None_');
  }
  return lines.join('\n');
}
