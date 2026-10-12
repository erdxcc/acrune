/** Names shown in wallets and explorers. */
export const COLLECTION_NAME = 'Acrune Grimoires';
export const SYMBOL = 'ACRUNE';

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function grimoireName(owner: string): string {
  return `Grimoire · ${shortAddress(owner)}`;
}
