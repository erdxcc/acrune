import type { RelayerSession } from '../idos/account';

/** HTTP client for the relayer, which verifies the iDos session and writes the grimoire to Solana. */

export type GrimoireWrite =
  | { status: 'written'; asset: string; signatures: string[] }
  | { status: 'pending'; asset: string; signatures: string[] }
  | { status: 'unchanged'; asset: string }
  | { status: 'no-wallet' }
  | { status: 'error'; error: string };

export interface RunStats {
  durationMs: number;
  casts: number;
  precise: number;
  parries: number;
}

export interface FinishResponse {
  progressToken: string;
  /** False when the win did not count (wrong order, implausible stats). */
  counted: boolean;
  grimoire: GrimoireWrite;
}

export interface GrimoireView {
  wallet: string;
  asset: string;
  exists: boolean;
  /** Page block, base64 (decode with decodePages). */
  pages: string | null;
  attributes: Record<string, string>;
  image: string;
}

export class RelayerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class RelayerClient {
  constructor(readonly baseUrl: string) {}

  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  startRun(session: RelayerSession, battleId: string): Promise<{ runToken: string }> {
    return this.post('/v1/run/start', { ...session, battleId });
  }

  finishRun(
    session: RelayerSession,
    body: { runToken: string; progressToken: string | null; result: 'win' | 'loss'; stats: RunStats; pages: string | null },
  ): Promise<FinishResponse> {
    return this.post('/v1/run/finish', { ...session, ...body });
  }

  sync(session: RelayerSession, progressToken: string, pages: string | null): Promise<{ grimoire: GrimoireWrite }> {
    return this.post('/v1/grimoire/sync', { ...session, progressToken, pages });
  }

  async grimoire(wallet: string): Promise<GrimoireView> {
    const response = await fetch(`${this.baseUrl}/v1/grimoire/${encodeURIComponent(wallet)}`);
    return this.read<GrimoireView>(response);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.read<T>(response);
  }

  private async read<T>(response: Response): Promise<T> {
    const text = await response.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON: report the status line below.
    }
    if (!response.ok) {
      const message = (data as { error?: string } | null)?.error ?? `${response.status} ${response.statusText}`;
      throw new RelayerError(message, response.status);
    }
    return data as T;
  }
}
