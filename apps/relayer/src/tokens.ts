import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed tokens: base64url(JSON) "." base64url(HMAC-SHA256).
 * The game stores them in the player's iDos data; only this relayer can mint them.
 */

export interface RunClaims {
  v: 1;
  kind: 'run';
  userId: string;
  titleId: string;
  battleId: string;
  /** Relayer clock, ms. */
  startedAt: number;
}

export interface ProgressClaims {
  v: 1;
  kind: 'progress';
  userId: string;
  titleId: string;
  cleared: string[];
  /** Fastest counted win per battle, ms. */
  times: Record<string, number>;
  bossDefeated: boolean;
  /** Sum of the fastest wins once the chapter is cleared. */
  bestTimeMs: number | null;
  casts: number;
  precise: number;
  parries: number;
  /** startedAt of the last counted run; older run tokens no longer count. */
  lastRunAt: number;
  updatedAt: number;
}

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function signToken(claims: RunClaims | ProgressClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

export function verifyToken<K extends 'run' | 'progress'>(
  token: unknown,
  kind: K,
  secret: string,
): (K extends 'run' ? RunClaims : ProgressClaims) | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { v?: unknown; kind?: unknown };
    if (claims.v !== 1 || claims.kind !== kind) return null;
    return claims as K extends 'run' ? RunClaims : ProgressClaims;
  } catch {
    return null;
  }
}
