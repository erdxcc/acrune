/** Relayer base URL, e.g. https://grimoire-relayer.vercel.app. Empty: Solana features are off. */
export const RELAYER_URL = (import.meta.env.VITE_RELAYER_URL ?? '').replace(/\/+$/, '');

export const SOLANA_CLUSTER = 'devnet';

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${SOLANA_CLUSTER}`;
}

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
