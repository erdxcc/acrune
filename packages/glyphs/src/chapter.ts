import type { SpellKey } from './spells';

/**
 * Chapter progression shared by the game and the relayer. The relayer uses it
 * to check battle order, minimum durations and which spells a page may hold.
 */

export interface BattleProgress {
  id: string;
  /** 1-based position in the chapter. */
  order: number;
  /** Shortest plausible win, checked by the relayer. */
  minDurationSec: number;
  /** Spells recorded in the grimoire when this battle is reached. */
  unlocks: readonly SpellKey[];
  /** Grimoire pages the player may take into this battle. */
  pageLimit: number;
  boss?: boolean;
}

export const CHAPTER_ID = 'chapter-1';

export const BATTLES: readonly BattleProgress[] = [
  // Enemies come out one at a time. Minimum durations sit below what a player who draws
  // a precise glyph every half second could do, and below the bot run in apps/game balance.test.ts.
  { id: 'c1-b1', order: 1, minDurationSec: 4, unlocks: ['fire'], pageLimit: 4 },
  { id: 'c1-b2', order: 2, minDurationSec: 6, unlocks: ['water'], pageLimit: 6 },
  { id: 'c1-b3', order: 3, minDurationSec: 6, unlocks: ['air', 'earth', 'steam', 'ice'], pageLimit: 10 },
  { id: 'c1-boss', order: 4, minDurationSec: 10, unlocks: ['magma'], pageLimit: 12, boss: true },
];

export function battleById(id: string): BattleProgress | undefined {
  return BATTLES.find((b) => b.id === id);
}

/** A battle can be played once the one before it is cleared. Replays are allowed. */
export function canPlay(battleId: string, cleared: readonly string[]): boolean {
  const battle = battleById(battleId);
  if (!battle) return false;
  if (battle.order === 1) return true;
  const previous = BATTLES.find((b) => b.order === battle.order - 1);
  return previous !== undefined && cleared.includes(previous.id);
}

/** First battle not cleared yet, or undefined when the chapter is done. */
export function nextBattle(cleared: readonly string[]): BattleProgress | undefined {
  return BATTLES.find((b) => !cleared.includes(b.id));
}

/** Spells known when entering `battleId`: everything unlocked up to and including it. */
export function spellsForBattle(battleId: string): SpellKey[] {
  const battle = battleById(battleId);
  if (!battle) return [];
  return BATTLES.filter((b) => b.order <= battle.order).flatMap((b) => b.unlocks);
}

/** Spells known after clearing `cleared`: the reached battle's unlocks included. */
export function knownSpells(cleared: readonly string[]): SpellKey[] {
  const reached = nextBattle(cleared) ?? BATTLES[BATTLES.length - 1]!;
  return spellsForBattle(reached.id);
}

export function chapterCleared(cleared: readonly string[]): boolean {
  return BATTLES.every((b) => cleared.includes(b.id));
}
