'use client';
import { getNetworkDetails, isConnected, requestAccess, signMessage, signTransaction } from '@stellar/freighter-api';

export class WalletUxError extends Error {}

/** Connects Freighter and refuses when it is on a different network than the app. */
export async function connect(expectedPassphrase: string): Promise<string> {
  const c = await isConnected();
  if (!c.isConnected) throw new WalletUxError('Freighter is not installed. Get it at https://freighter.app');
  const a = await requestAccess();
  if (a.error || !a.address) throw new WalletUxError('Freighter access was declined.');
  const n = await getNetworkDetails();
  if (n.networkPassphrase !== expectedPassphrase) throw new WalletUxError(`Switch Freighter to the network this app uses (${expectedPassphrase}).`);
  return a.address;
}

/** SEP-53 message signature as base64 (Freighter returns a Buffer or a base64 string depending on version). */
export async function signLinkMessage(message: string, address: string, passphrase: string): Promise<string> {
  const r = await signMessage(message, { address, networkPassphrase: passphrase });
  if (r.error || !r.signedMessage) throw new WalletUxError('Signing was declined.');
  const m = r.signedMessage as unknown;
  return typeof m === 'string' ? m : Buffer.from(m as Uint8Array).toString('base64');
}

/** Signs a prepared transaction XDR in Freighter; returns the signed XDR. */
export async function signTx(xdr: string, address: string, passphrase: string): Promise<string> {
  const r = await signTransaction(xdr, { networkPassphrase: passphrase, address });
  if (r.error || !r.signedTxXdr) throw new WalletUxError('Signing was declined.');
  return r.signedTxXdr;
}
