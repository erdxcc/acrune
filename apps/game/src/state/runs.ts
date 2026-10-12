import { encodePages, type Page } from '@grimoire/glyphs';
import { app } from '../app';
import type { GrimoireWrite, RunStats } from '../relayer/client';
import { bytesToBase64 } from './profile';

/**
 * A battle's round trip: the relayer issues a run token at the start and, on a
 * win, returns a new signed progress token and writes the grimoire on Solana.
 * Progress and pages are saved locally first, so a failed request loses nothing.
 */

export type SaveOutcome =
  | { kind: 'saved'; counted: boolean; grimoire: GrimoireWrite }
  | { kind: 'offline' }
  | { kind: 'lost' }
  | { kind: 'error'; message: string };

export async function startRun(battleId: string): Promise<string | null> {
  const { relayer, account } = app();
  const session = account.session();
  if (!relayer.enabled || !session) return null;
  try {
    return (await relayer.startRun(session, battleId)).runToken;
  } catch (e) {
    console.warn('run/start failed', e);
    return null;
  }
}

function packedPages(pages: readonly Page[]): string | null {
  return pages.length > 0 ? bytesToBase64(encodePages(pages)) : null;
}

export async function finishRun(options: {
  battleId: string;
  won: boolean;
  runToken: Promise<string | null>;
  stats: RunStats;
  pages: Page[];
}): Promise<SaveOutcome> {
  const { relayer, account, profile } = app();
  if (options.pages.length > 0) await profile.savePages(options.pages).catch((e) => console.warn('save pages', e));
  if (!options.won) return { kind: 'lost' };

  profile.markCleared(options.battleId);
  const runToken = await options.runToken;
  const session = account.session();
  if (!relayer.enabled || !session || !runToken) {
    await profile.saveProgress().catch((e) => console.warn('save progress', e));
    return { kind: 'offline' };
  }
  try {
    const response = await relayer.finishRun(session, {
      runToken,
      progressToken: profile.progressToken,
      result: 'win',
      stats: options.stats,
      pages: packedPages(profile.pages),
    });
    profile.applyToken(response.progressToken);
    await profile.saveProgress();
    return { kind: 'saved', counted: response.counted, grimoire: response.grimoire };
  } catch (e) {
    await profile.saveProgress().catch(() => undefined);
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Writes everything so far to the grimoire, e.g. right after a guest links a wallet. */
export async function syncGrimoire(): Promise<GrimoireWrite> {
  const { relayer, account, profile } = app();
  const session = account.session();
  if (!relayer.enabled || !session) return { status: 'error', error: 'Solana sync is not configured.' };
  if (!profile.progressToken) return { status: 'error', error: 'Win a battle first.' };
  try {
    return (await relayer.sync(session, profile.progressToken, packedPages(profile.pages))).grimoire;
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
