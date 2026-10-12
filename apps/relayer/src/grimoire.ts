import {
  battleById,
  canPlay,
  chapterCleared,
  DEFAULT_TEMPLATES,
  knownSpells,
  PAGES_FORMAT,
  Recognizer,
  scorePage,
  spellById,
  type Page,
} from '@grimoire/glyphs';
import type { ProgressClaims, RunClaims } from './tokens';

/** Rules for counting a win and accepting drawings. Pure; the routes call it. */

export const recognizer = new Recognizer(DEFAULT_TEMPLATES);

export interface RunStats {
  durationMs: number;
  casts: number;
  precise: number;
  parries: number;
}

export function emptyProgress(userId: string, titleId: string, now: number): ProgressClaims {
  return {
    v: 1,
    kind: 'progress',
    userId,
    titleId,
    cleared: [],
    times: {},
    bossDefeated: false,
    bestTimeMs: null,
    casts: 0,
    precise: 0,
    parries: 0,
    lastRunAt: 0,
    updatedAt: now,
  };
}

export type WinResult = { counted: true; progress: ProgressClaims } | { counted: false; progress: ProgressClaims; reason: string };

function count(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100_000 ? n : null;
}

/** Applies a reported win to the progress, if it is plausible. Time comes from the relayer's own clock. */
export function applyWin(progress: ProgressClaims, run: RunClaims, stats: RunStats, now: number): WinResult {
  const refuse = (reason: string): WinResult => ({ counted: false, progress, reason });
  const battle = battleById(run.battleId);
  if (!battle) return refuse('unknown battle');
  if (!canPlay(battle.id, progress.cleared)) return refuse('battles must be cleared in order');
  if (run.startedAt <= progress.lastRunAt) return refuse('this run was already reported');
  const elapsed = now - run.startedAt;
  if (elapsed < battle.minDurationSec * 1000) return refuse(`a win takes at least ${battle.minDurationSec} s`);
  const casts = count(stats.casts);
  const precise = count(stats.precise);
  const parries = count(stats.parries);
  if (casts === null || precise === null || parries === null) return refuse('malformed stats');
  if (precise > casts || parries > casts) return refuse('implausible stats');
  if (casts > Math.ceil((elapsed / 1000) * 4)) return refuse('too many casts for the time');

  const cleared = progress.cleared.includes(battle.id) ? progress.cleared : [...progress.cleared, battle.id];
  const times = { ...progress.times, [battle.id]: Math.min(progress.times[battle.id] ?? Infinity, elapsed) };
  const done = chapterCleared(cleared);
  return {
    counted: true,
    progress: {
      ...progress,
      cleared,
      times,
      bossDefeated: progress.bossDefeated || battle.boss === true,
      bestTimeMs: done ? Object.values(times).reduce((a, b) => a + b, 0) : null,
      casts: progress.casts + casts,
      precise: progress.precise + precise,
      parries: progress.parries + parries,
      lastRunAt: run.startedAt,
      updatedAt: now,
    },
  };
}

/**
 * Re-checks every drawing with the shared recognizer: it must match its spell
 * with a score of at least 70, and the spell must be unlocked. The stored
 * accuracy is the relayer's own score, not the client's claim.
 */
export function acceptPages(pages: readonly Page[], cleared: readonly string[]): { accepted: Page[]; rejected: number } {
  const allowed = knownSpells(cleared);
  const best = new Map<number, Page>();
  let rejected = 0;
  for (const page of pages) {
    const spell = spellById(page.spellId);
    if (!spell || !allowed.includes(spell.key)) {
      rejected++;
      continue;
    }
    const check = scorePage(recognizer, spell.key, page);
    if (!check.ok) {
      rejected++;
      continue;
    }
    const scored: Page = { ...page, accuracy: Math.floor(check.accuracy) };
    const current = best.get(page.spellId);
    if (!current || current.accuracy < scored.accuracy) best.set(page.spellId, scored);
  }
  return { accepted: [...best.values()].sort((a, b) => a.spellId - b.spellId), rejected };
}

/** Keeps the more accurate drawing of each spell. */
export function mergePages(current: readonly Page[], incoming: readonly Page[]): Page[] {
  const best = new Map<number, Page>();
  for (const page of [...current, ...incoming]) {
    const existing = best.get(page.spellId);
    if (!existing || existing.accuracy < page.accuracy) best.set(page.spellId, page);
  }
  return [...best.values()].sort((a, b) => a.spellId - b.spellId);
}

export interface Attribute {
  key: string;
  value: string;
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function attributesFor(progress: ProgressClaims, pages: readonly Page[]): Attribute[] {
  return [
    { key: 'Chapter 1', value: chapterCleared(progress.cleared) ? 'Cleared' : 'In progress' },
    { key: 'Boss', value: progress.bossDefeated ? 'Defeated' : 'Not yet' },
    { key: 'Spells', value: String(pages.length) },
    { key: 'Accuracy', value: progress.casts > 0 ? `${Math.round((100 * progress.precise) / progress.casts)}%` : '-' },
    { key: 'Parries', value: String(progress.parries) },
    { key: 'Best time', value: progress.bestTimeMs !== null ? clock(progress.bestTimeMs) : '-' },
    { key: 'Format', value: String(PAGES_FORMAT) },
  ];
}
