import { describe, expect, it } from 'vitest';
import { Errors } from '@skillescrow/contract-client';
import { CONTRACT_ERROR_TEXT, errorText } from './errors';

describe('contract error messages', () => {
  it('has non-empty user-facing text for every generated contract error', () => {
    for (const { message } of Object.values(Errors)) expect(CONTRACT_ERROR_TEXT[message]).toMatch(/\S/);
  });

  it('maps numeric and named contract errors to the same text', () => {
    for (const [number, { message }] of Object.entries(Errors)) {
      expect(errorText(`contract_${message}`, 'fallback')).toBe(CONTRACT_ERROR_TEXT[message]);
      expect(errorText(`Error(Contract, #${number})`, 'fallback')).toBe(CONTRACT_ERROR_TEXT[message]);
    }
  });

  it('keeps a safe fallback for unknown codes', () => {
    expect(errorText('contract_FutureError', 'Please try again.')).toBe('Please try again.');
    expect(errorText(undefined, 'Please try again.')).toBe('Please try again.');
  });
});
