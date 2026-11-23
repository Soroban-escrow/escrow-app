import { describe, expect, it } from 'vitest';
import { isStaleEventId } from './apply.js';

describe('isStaleEventId', () => {
  it('compares TOIDs numerically across digit-length boundaries', () => {
    expect(isStaleEventId('9999999999999999999-0000000001', '10000000000000000000-0000000000')).toBe(false);
    expect(isStaleEventId('10000000000000000000-0000000000', '9999999999999999999-0000000001')).toBe(true);
    expect(isStaleEventId('0000000000000000123-0000000009', '0000000000000000124-0000000000')).toBe(false);
  });

  it('compares event indexes numerically within the same TOID', () => {
    expect(isStaleEventId('0000000000000000123-0000000009', '0000000000000000123-0000000010')).toBe(false);
    expect(isStaleEventId('0000000000000000123-0000000010', '0000000000000000123-0000000009')).toBe(true);
    expect(isStaleEventId('0000000000000000123-0000000010', '0000000000000000123-0000000010')).toBe(true);
  });

  it('handles legacy unpadded ids and missing values', () => {
    expect(isStaleEventId(null, '1')).toBe(false);
    expect(isStaleEventId('9', '10')).toBe(false);
    expect(isStaleEventId('10', '9')).toBe(true);
    expect(isStaleEventId('opaque-b', 'opaque-a')).toBe(true);
  });
});
