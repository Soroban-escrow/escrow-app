import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  type ContractErrorName,
  CONTRACT_ERROR_NAMES,
  CONTRACT_ERROR_NUMBERS,
} from '@skillescrow/contract-client';
import {
  APP_ERROR_TEXT,
  CONTRACT_ERROR_TEXT,
  errorText,
  TEXT,
  _resetLoggedUnknownCodes,
} from './errors';

// ---------------------------------------------------------------------------
// 1. Type-Level Acceptance Tests
// ---------------------------------------------------------------------------
// Compile-time check ensuring every member of ContractErrorName is present
// in CONTRACT_ERROR_TEXT with zero missing keys.
type Assert<T extends true> = T;
type ExpectNever<T extends never> = T;

// 1. Verifies at compile time that CONTRACT_ERROR_TEXT has NO missing keys from ContractErrorName:
type MissingFromText = Exclude<ContractErrorName, keyof typeof CONTRACT_ERROR_TEXT>;
type _NoMissingKeys = ExpectNever<MissingFromText>;

// 2. Verifies at compile time that all keys in CONTRACT_ERROR_TEXT are valid ContractErrorNames:
type ExtraKeys = Exclude<keyof typeof CONTRACT_ERROR_TEXT, ContractErrorName>;
type _NoExtraKeys = ExpectNever<ExtraKeys>;

// ---------------------------------------------------------------------------
// 2. Runtime Acceptance Tests
// ---------------------------------------------------------------------------
describe('contract error mappings & user-facing messages (Issue #18)', () => {
  beforeEach(() => {
    _resetLoggedUnknownCodes();
    vi.restoreAllMocks();
  });

  it('covers all 17 contract errors with non-empty user-facing messages', () => {
    const errorNumbers = Object.keys(CONTRACT_ERROR_NAMES).map(Number);
    expect(errorNumbers.length).toBe(17);

    for (const [name, text] of Object.entries(CONTRACT_ERROR_TEXT)) {
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(10);
    }
  });

  it('maps named forms (contract_<Name> and bare <Name>) identically', () => {
    for (const name of Object.values(CONTRACT_ERROR_NAMES)) {
      const fallback = 'DEFAULT_FALLBACK';
      const prefixed = errorText(`contract_${name}`, fallback);
      const bare = errorText(name, fallback);

      expect(prefixed).not.toBe(fallback);
      expect(bare).not.toBe(fallback);
      expect(prefixed).toBe(bare);
      expect(prefixed).toBe(CONTRACT_ERROR_TEXT[name]);
    }
  });

  it('maps numeric forms (Error(Contract, #N), contract_N, #N, N) identically to named forms', () => {
    for (const [numStr, name] of Object.entries(CONTRACT_ERROR_NAMES)) {
      const num = Number(numStr);
      const fallback = 'DEFAULT_FALLBACK';
      const expectedText = CONTRACT_ERROR_TEXT[name];

      // Format 1: Error(Contract, #N)
      expect(errorText(`Error(Contract, #${num})`, fallback)).toBe(expectedText);

      // Format 2: Error(Contract, N)
      expect(errorText(`Error(Contract, ${num})`, fallback)).toBe(expectedText);

      // Format 3: contract_N
      expect(errorText(`contract_${num}`, fallback)).toBe(expectedText);

      // Format 4: #N
      expect(errorText(`#${num}`, fallback)).toBe(expectedText);

      // Format 5: raw integer string N
      expect(errorText(String(num), fallback)).toBe(expectedText);
    }
  });

  it('correctly maps application-level error codes', () => {
    const appCodes = Object.keys(APP_ERROR_TEXT) as (keyof typeof APP_ERROR_TEXT)[];
    expect(appCodes.length).toBeGreaterThan(0);

    for (const code of appCodes) {
      const fallback = 'FALLBACK';
      expect(errorText(code, fallback)).toBe(APP_ERROR_TEXT[code]);
    }
  });

  it('falls back to provided fallback string for unknown, empty, or undefined codes', () => {
    const fallback = 'Safe generic fallback message';

    expect(errorText('completely_unknown_error_code', fallback)).toBe(fallback);
    expect(errorText('Error(Contract, #99999)', fallback)).toBe(fallback);
    expect(errorText(undefined, fallback)).toBe(fallback);
    expect(errorText(null, fallback)).toBe(fallback);
    expect(errorText('', fallback)).toBe(fallback);
  });

  it('logs unknown error codes to console.warn once in development (no duplicate spam)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    errorText('unknown_alpha', 'fallback');
    errorText('unknown_alpha', 'fallback');
    errorText('unknown_alpha', 'fallback');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[errors] Unknown error code received: "unknown_alpha"')
    );

    errorText('unknown_beta', 'fallback');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[errors] Unknown error code received: "unknown_beta"')
    );
  });
});
