import type { Page } from '@playwright/test';

export const FAKE_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export const TEST_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Implements Freighter's documented page message bridge with deterministic scripted replies. */
export async function installFakeWallet(page: Page, options: { passphrase?: string; decline?: string } = {}) {
  await page.addInitScript(({ address, passphrase, decline }) => {
    const w = window as typeof window & { freighter?: boolean; __walletRequests?: unknown[] };
    w.freighter = true;
    w.__walletRequests = [];
    window.addEventListener('message', (event) => {
      const request = event.data;
      if (event.source !== window || request?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      w.__walletRequests!.push(request);
      const denied = request.type === decline;
      const response: Record<string, unknown> = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: request.messageId };
      if (denied) response.apiError = { code: 1, message: 'User declined' };
      else if (request.type === 'REQUEST_ACCESS' || request.type === 'REQUEST_PUBLIC_KEY') response.publicKey = address;
      else if (request.type === 'REQUEST_NETWORK_DETAILS') response.networkDetails = { network: 'TESTNET', networkUrl: 'https://horizon-testnet.stellar.org', networkPassphrase: passphrase, sorobanRpcUrl: 'https://soroban-testnet.stellar.org' };
      else if (request.type === 'REQUEST_ALLOWED_STATUS') response.isAllowed = true;
      else if (request.type === 'SUBMIT_BLOB') { response.signedBlob = 'ZmFrZS1zaWduYXR1cmU='; response.signerAddress = address; }
      else if (request.type === 'SUBMIT_TRANSACTION') { response.signedTransaction = `signed:${request.transactionXdr}`; response.signerAddress = address; }
      setTimeout(() => window.postMessage(response, window.location.origin), 0);
    });
  }, { address: FAKE_ADDRESS, passphrase: options.passphrase ?? TEST_PASSPHRASE, decline: options.decline ?? '' });
}

export async function mockConfig(page: Page) {
  await page.route('**/api/config', (route) => route.fulfill({ json: { feeBps: 300, tokens: [{ address: 'CUSDCE2E', symbol: 'USDC', decimals: 7, minAmount: '1', maxAmount: '999999999999' }] } }));
}
