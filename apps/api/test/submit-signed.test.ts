import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmitTxError } from '../src/chain/errors.js';

const { fakeTx, fromXDR } = vi.hoisted(() => {
  const fakeTx = { source: 'GSOURCE', operations: [{ type: 'invokeHostFunction' }] as any[] };
  const fromXDR = vi.fn(() => fakeTx);
  return { fakeTx, fromXDR };
});

vi.mock('@skillescrow/contract-client', () => ({ Client: class {} }));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class FakeTransaction {
    source = fakeTx.source;
    operations = fakeTx.operations;
  }
  Object.setPrototypeOf(fakeTx, FakeTransaction.prototype);
  return {
    ...actual,
    TransactionBuilder: { ...actual.TransactionBuilder, fromXDR },
    Transaction: FakeTransaction,
  };
});

import { createChain } from '../src/chain/client.js';

const cfg = {
  rpcUrl: 'https://rpc.example',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
};

function makeChain(sendTransaction: ReturnType<typeof vi.fn>) {
  return createChain(cfg, { sendTransaction } as any);
}

beforeEach(() => {
  vi.useFakeTimers();
  fromXDR.mockClear();
  fakeTx.source = 'GSOURCE';
  fakeTx.operations = [{ type: 'invokeHostFunction' }];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('submitSigned', () => {
  it('returns hash on PENDING', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    const chain = makeChain(send);
    await expect(chain.submitSigned('XDR')).resolves.toBe('abc123');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns existing hash on DUPLICATE', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'DUPLICATE', hash: 'dup-hash' });
    const chain = makeChain(send);
    await expect(chain.submitSigned('XDR')).resolves.toBe('dup-hash');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries TRY_AGAIN_LATER then succeeds', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'h1' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'h2' });
    const chain = makeChain(send);
    const p = chain.submitSigned('XDR');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('h2');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('throws typed error after bounded TRY_AGAIN_LATER retries', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'h-retry' });
    const chain = makeChain(send);
    const p = chain.submitSigned('XDR');
    const assertion = expect(p).rejects.toSatisfy((e: unknown) => {
      const err = e as SubmitTxError;
      return err instanceof SubmitTxError && err.code === 'TRY_AGAIN_LATER' && err.hash === 'h-retry' && err.attempts === 3;
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('throws on ERROR status', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'ERROR', hash: 'bad' });
    const chain = makeChain(send);
    await expect(chain.submitSigned('XDR')).rejects.toThrow('submit failed: ERROR');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('validates expected source', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'ok' });
    const chain = makeChain(send);
    await expect(chain.submitSigned('XDR', 'GOTHER')).rejects.toThrow('unexpected source account');
    expect(send).not.toHaveBeenCalled();
  });
});
