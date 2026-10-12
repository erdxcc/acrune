/**
 * The signed-in player as the rest of the game sees it: saves, the session the
 * relayer checks, and the linked Solana wallet. `IdosAccount` talks to iDos;
 * `OfflineAccount` keeps saves in localStorage when no title is configured.
 */

export type SaveKey = 'progress' | 'pages' | 'settings';

export type Outcome = { ok: true } | { ok: false; error: string };

export interface RelayerSession {
  titleId: string;
  userId: string;
  ticket: string;
}

export interface Account {
  readonly mode: 'idos' | 'offline';
  readonly userId: string;
  read(key: SaveKey): string | null;
  write(key: SaveKey, value: string): Promise<Outcome>;
  /** Credentials the relayer verifies with iDos; null offline. */
  session(): RelayerSession | null;
  /** Signature-verified Solana wallet linked to this account. */
  linkedWallet(refresh?: boolean): Promise<string | null>;
  linkWallet(): Promise<Outcome>;
  signOut(): void;
}

const PREFIX = 'grimoire.offline.';

export class OfflineAccount implements Account {
  readonly mode = 'offline' as const;
  readonly userId = 'offline';

  read(key: SaveKey): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  }

  async write(key: SaveKey, value: string): Promise<Outcome> {
    try {
      localStorage.setItem(PREFIX + key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  session(): RelayerSession | null {
    return null;
  }

  async linkedWallet(): Promise<string | null> {
    return null;
  }

  async linkWallet(): Promise<Outcome> {
    return { ok: false, error: 'Wallets need an iDos title. Set VITE_IDOS_TITLE_ID.' };
  }

  signOut(): void {}
}
