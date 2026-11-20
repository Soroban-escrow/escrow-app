import { Account, Keypair, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createChain } from '../src/chain/client.js';
import { contractErrorName } from '../src/chain/errors.js';

describe('contractErrorName', () => {
  it('maps contract error numbers', () => {
    expect(contractErrorName('HostError: Error(Contract, #11)')).toBe('InvalidStatus');
    expect(contractErrorName('Error(Contract, #17)')).toBe('RelayerNotAllowed');
    expect(contractErrorName('Error(Contract, #99)')).toBeUndefined();
    expect(contractErrorName('boom')).toBeUndefined();
  });
});

describe('submitSigned validation', () => {
  const contractId = 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V';
  const foreignContractId = StrKey.encodeContract(Buffer.alloc(32, 1));
  const passphrase = 'Test SDF Network ; September 2015';

  function buildTestTx(contract: string, fnName: string, sourceKey: Keypair = Keypair.random()) {
    const account = new Account(sourceKey.publicKey(), '100');
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase })
      .addOperation(
        Operation.invokeContractFunction({
          contract,
          function: fnName,
          args: [],
        }),
      )
      .setTimeout(30)
      .build();
    tx.sign(sourceKey);
    return tx.toXDR();
  }

  it('rejects calls targeting a foreign contract', async () => {
    const chain = createChain({ rpcUrl: 'http://localhost:8000', networkPassphrase: passphrase, contractId });
    const xdr = buildTestTx(foreignContractId, 'fund_bounty');
    await expect(chain.submitSigned(xdr)).rejects.toThrow(/foreign contract/);
  });

  it('rejects calls with a disallowed function', async () => {
    const chain = createChain({ rpcUrl: 'http://localhost:8000', networkPassphrase: passphrase, contractId });
    const xdr = buildTestTx(contractId, 'transfer');
    await expect(chain.submitSigned(xdr)).rejects.toThrow(/disallowed contract function: transfer/);
  });

  it('accepts allowed functions and passes to server', async () => {
    const chain = createChain({ rpcUrl: 'http://localhost:8000', networkPassphrase: passphrase, contractId });
    vi.spyOn(chain.server, 'sendTransaction').mockResolvedValue({
      status: 'PENDING',
      hash: 'testhash123',
    } as any);

    const xdr = buildTestTx(contractId, 'fund_bounty');
    const hash = await chain.submitSigned(xdr);
    expect(hash).toBe('testhash123');
  });
});
