import type { IDosGamesClient } from '@idosgames/core';
import {
  linkWalletSolana,
  linkWalletViaPlatform,
  loginWithWalletSolana,
  loginWithWalletViaPlatform,
} from '@idosgames/wallet';
import { getWallets } from '@wallet-standard/app';
import type { Outcome } from './account';
import { isEmbedded } from './title';

/**
 * Wallet sign-in and linking, loaded only after the player presses a wallet
 * button. Inside the idosgames.com iframe the site's own wallet signs; on the
 * direct link the browser wallet (Phantom, Solflare via Wallet Standard) does.
 */

type Mode = 'login' | 'link';

interface BrowserWallet {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

interface StandardConnect {
  connect(): Promise<{ accounts: readonly { address: string }[] }>;
}

interface StandardSignMessage {
  signMessage(...inputs: { account: unknown; message: Uint8Array }[]): Promise<readonly { signature: Uint8Array }[]>;
}

const PREFERRED = ['Phantom', 'Solflare', 'Backpack'];

function rank(name: string): number {
  const i = PREFERRED.indexOf(name);
  return i < 0 ? PREFERRED.length : i;
}

async function connectBrowserWallet(): Promise<BrowserWallet> {
  const wallet = getWallets()
    .get()
    .filter((w) => 'standard:connect' in w.features && 'solana:signMessage' in w.features)
    .sort((a, b) => rank(a.name) - rank(b.name))[0];
  if (!wallet) throw new Error('No Solana wallet found. Install Phantom or Solflare.');
  const connect = wallet.features['standard:connect'] as StandardConnect;
  const sign = wallet.features['solana:signMessage'] as StandardSignMessage;
  const { accounts } = await connect.connect();
  const account = accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account.`);
  return {
    address: account.address,
    signMessage: async (message) => {
      const [out] = await sign.signMessage({ account, message });
      if (!out) throw new Error('The wallet returned no signature.');
      return out.signature;
    },
  };
}

export async function walletFlow(client: IDosGamesClient, networkID: string, mode: Mode): Promise<Outcome> {
  try {
    if (isEmbedded()) {
      const params = { client, networkID, family: 'solana' as const };
      const result = mode === 'login' ? await loginWithWalletViaPlatform(params) : await linkWalletViaPlatform(params);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    const wallet = await connectBrowserWallet();
    const params = { client, networkID, walletAddress: wallet.address, signMessage: (m: Uint8Array) => wallet.signMessage(m) };
    const result = mode === 'login' ? await loginWithWalletSolana(params) : await linkWalletSolana(params);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
