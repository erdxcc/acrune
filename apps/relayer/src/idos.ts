/**
 * Checks an iDos session server-side by calling the Client API with the
 * player's own ticket, the way the SDK does:
 *   POST {base}/api/v2/{TitleID}/Client/{Module}/{Action}/{UserID}
 *   Authorization: Bearer {ClientSessionTicket}, body { UserID, ClientSessionTicket }
 *   → { Success, Error, Data }
 */

export interface IdosSession {
  titleId: string;
  userId: string;
  ticket: string;
}

/** 8 characters of [A-Z0-9], optionally -DEV. */
export const TITLE_ID_RE = /^[A-Z0-9]{8}(-DEV)?$/;
export const USER_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
export const TICKET_RE = /^[\x21-\x7e]{16,4096}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function wellFormed(s: IdosSession): boolean {
  return TITLE_ID_RE.test(s.titleId) && USER_ID_RE.test(s.userId) && TICKET_RE.test(s.ticket);
}

type Call = { status: 'ok'; data: unknown } | { status: 'invalid' } | { status: 'unavailable' };

export class IdosApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 6000,
  ) {}

  private async call(s: IdosSession, action: string): Promise<Call> {
    if (!wellFormed(s)) return { status: 'invalid' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v2/${s.titleId}/Client/${action}/${encodeURIComponent(s.userId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${s.ticket}`, 'x-ig-platform': 'Web' },
        body: JSON.stringify({ UserID: s.userId, ClientSessionTicket: s.ticket }),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) return { status: 'invalid' };
      if (!res.ok) return { status: 'unavailable' };
      const body = (await res.json().catch(() => null)) as { Success?: unknown; Data?: unknown } | null;
      if (!body || typeof body !== 'object') return { status: 'unavailable' };
      return body.Success === true ? { status: 'ok', data: body.Data ?? body } : { status: 'invalid' };
    } catch {
      return { status: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** True when iDos accepts the ticket for this user and title. */
  async verify(s: IdosSession): Promise<'ok' | 'invalid' | 'unavailable'> {
    const result = await this.call(s, 'User/GetUsageTime');
    return result.status;
  }

  /** The Solana wallet linked to the account by signature, if any. */
  async linkedSolanaWallet(s: IdosSession): Promise<{ status: 'ok'; wallet: string | null } | { status: 'invalid' | 'unavailable' }> {
    const result = await this.call(s, 'Blockchain/GetUserState');
    if (result.status !== 'ok') return result;
    return { status: 'ok', wallet: pickSolanaWallet(result.data) };
  }
}

interface LinkedWallet {
  Address?: string;
  IsSignatureVerified?: boolean;
}

/** Finds a signature-verified Solana address in a GetUserState answer. */
export function pickSolanaWallet(data: unknown): string | null {
  const d = data as { State?: { LinkedWallets?: Record<string, LinkedWallet> }; LinkedWallets?: Record<string, LinkedWallet> } | null;
  const wallets = d?.State?.LinkedWallets ?? d?.LinkedWallets ?? {};
  for (const wallet of Object.values(wallets)) {
    if (wallet?.IsSignatureVerified && typeof wallet.Address === 'string' && SOLANA_ADDRESS_RE.test(wallet.Address)) return wallet.Address;
  }
  return null;
}
