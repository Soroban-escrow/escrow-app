'use client';
import * as freighter from './freighter';

export type WalletAdapter = {
  id: string;
  name: string;
  connect(passphrase: string): Promise<string>;
  signMessage(message: string, address: string, passphrase: string): Promise<string>;
  signTransaction(xdr: string, address: string, passphrase: string): Promise<string>;
};

/**
 * Wallet operations are routed through this registry instead of being coupled
 * to Freighter. Other Stellar wallets can register an adapter at startup
 * without changing funding, linking, release, or refund flows.
 */
const adapters: WalletAdapter[] = [{
  id: 'freighter', name: 'Freighter', connect: freighter.connect,
  signMessage: freighter.signLinkMessage, signTransaction: freighter.signTx,
}];

export function registerWalletAdapter(adapter: WalletAdapter) {
  if (!adapters.some((item) => item.id === adapter.id)) adapters.push(adapter);
}

export function availableWallets(): readonly WalletAdapter[] { return adapters; }

function active(): WalletAdapter {
  const id = typeof window === 'undefined' ? 'freighter' : window.localStorage.getItem('skillescrow.wallet') ?? 'freighter';
  return adapters.find((adapter) => adapter.id === id) ?? adapters[0]!;
}

export function selectWallet(id: string) { window.localStorage.setItem('skillescrow.wallet', id); }
export const connect = (passphrase: string) => active().connect(passphrase);
export const signLinkMessage = (message: string, address: string, passphrase: string) => active().signMessage(message, address, passphrase);
export const signTx = (xdr: string, address: string, passphrase: string) => active().signTransaction(xdr, address, passphrase);
export { WalletUxError } from './freighter';
