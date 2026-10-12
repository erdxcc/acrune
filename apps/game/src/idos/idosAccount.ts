import { createIDosGamesClient, type BlockchainDefinitions, type IDosGamesClient } from '@idosgames/core';
import type { Account, Outcome, RelayerSession, SaveKey } from './account';

function failure(result: { reason: string; error?: string | null }): Outcome {
  return { ok: false, error: result.error || result.reason };
}

export class IdosAccount implements Account {
  readonly mode = 'idos' as const;
  readonly client: IDosGamesClient;

  constructor(readonly titleId: string) {
    this.client = createIDosGamesClient({ titleID: titleId, throttleMs: 0 });
    this.client.auth.setRememberSession(true);
  }

  get userId(): string {
    return this.client.auth.context?.userID ?? '';
  }

  /**
   * autoLogin() only with a remembered session: on a first visit it would
   * silently create a guest account before the player chose how to sign in.
   */
  hasRememberedSession(): boolean {
    try {
      return Boolean(
        localStorage.getItem(`Saved_AuthType_${this.titleId}`) || localStorage.getItem(`Saved_Auth_RefreshToken_${this.titleId}`),
      );
    } catch {
      return false;
    }
  }

  async resume(): Promise<boolean> {
    if (!this.hasRememberedSession()) return false;
    const result = await this.client.auth.autoLogin();
    return result.ok;
  }

  async signInAsGuest(): Promise<Outcome> {
    const result = await this.client.auth.loginWithDeviceID();
    return result.ok ? { ok: true } : failure(result);
  }

  async signInWithWallet(): Promise<Outcome> {
    const networkID = await this.solanaNetworkId();
    if (!networkID) return { ok: false, error: 'This title has no Solana network configured.' };
    const { walletFlow } = await import('./wallet');
    return walletFlow(this.client, networkID, 'login');
  }

  async linkWallet(): Promise<Outcome> {
    const networkID = await this.solanaNetworkId();
    if (!networkID) return { ok: false, error: 'This title has no Solana network configured.' };
    const { walletFlow } = await import('./wallet');
    const result = await walletFlow(this.client, networkID, 'link');
    if (result.ok) await this.client.blockchain.getUserState();
    return result;
  }

  read(key: SaveKey): string | null {
    return this.client.data.user.state?.CustomData?.Private?.[key]?.Value ?? null;
  }

  async write(key: SaveKey, value: string): Promise<Outcome> {
    const result = await this.client.userCustomData.setPrivateData(key, value);
    return result.ok ? { ok: true } : failure(result);
  }

  session(): RelayerSession | null {
    const context = this.client.auth.context;
    if (!context?.userID || !context.clientSessionTicket) return null;
    return { titleId: this.titleId, userId: context.userID, ticket: context.clientSessionTicket };
  }

  async linkedWallet(refresh = false): Promise<string | null> {
    const networkID = await this.solanaNetworkId();
    if (!networkID) return null;
    if (refresh || !this.client.data.user.state?.Blockchain) await this.client.blockchain.getUserState();
    const wallet = this.client.data.user.state?.Blockchain?.LinkedWallets?.[networkID];
    return wallet?.IsSignatureVerified && wallet.Address ? wallet.Address : null;
  }

  signOut(): void {
    this.client.auth.logout();
  }

  /** The title's Solana network (key of Blockchain.Networks). */
  private async solanaNetworkId(): Promise<string | null> {
    await this.client.blockchain.getDefinitions();
    const defs = this.client.data.config.getSection<BlockchainDefinitions>('Blockchain');
    const entry = Object.entries(defs?.Networks ?? {}).find(([, net]) => net.Type === 'Solana');
    return entry?.[0] ?? null;
  }
}
