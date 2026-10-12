import { describe, expect, it } from 'vitest';
import {
  BATTLES,
  canPlay,
  chapterCleared,
  counterSpell,
  knownSpells,
  nextBattle,
  SPELL_KEYS,
  spellById,
  spellOfElements,
  spellsForBattle,
} from '../src';

describe('chapter progression', () => {
  it('unlocks every spell exactly once', () => {
    const unlocked = BATTLES.flatMap((b) => b.unlocks).sort();
    expect(unlocked).toEqual([...SPELL_KEYS].sort());
  });

  it('never shrinks the page limit', () => {
    BATTLES.forEach((b, i) => {
      if (i > 0) expect(b.pageLimit).toBeGreaterThanOrEqual(BATTLES[i - 1]!.pageLimit);
    });
  });

  it('plays battles in order and allows replays', () => {
    expect(canPlay('c1-b1', [])).toBe(true);
    expect(canPlay('c1-b2', [])).toBe(false);
    expect(canPlay('c1-b2', ['c1-b1'])).toBe(true);
    expect(canPlay('c1-boss', ['c1-b1', 'c1-b2'])).toBe(false);
    expect(canPlay('c1-b1', ['c1-b1', 'c1-b2'])).toBe(true);
    expect(canPlay('nope', [])).toBe(false);
  });

  it('knows which spells each battle brings', () => {
    expect(spellsForBattle('c1-b1')).toEqual(['fire']);
    expect(spellsForBattle('c1-b2')).toEqual(['fire', 'water']);
    expect(knownSpells([])).toEqual(['fire']);
    expect(knownSpells(['c1-b1', 'c1-b2'])).toContain('steam');
    expect(nextBattle(['c1-b1'])?.id).toBe('c1-b2');
  });

  it('is cleared only when every battle is', () => {
    expect(chapterCleared(['c1-b1', 'c1-b2', 'c1-b3'])).toBe(false);
    expect(chapterCleared(BATTLES.map((b) => b.id))).toBe(true);
    expect(nextBattle(BATTLES.map((b) => b.id))).toBeUndefined();
  });
});

describe('spells', () => {
  it('finds spells by on-chain id and by elements', () => {
    expect(spellById(1)?.key).toBe('fire');
    expect(spellById(12)?.key).toBe('ice');
    expect(spellById(99)).toBeUndefined();
    expect(spellOfElements(['water', 'fire'])).toBe('steam');
    expect(spellOfElements(['air', 'earth'])).toBeUndefined();
  });

  it('parries with the opposite, and combinations with the combination of opposites', () => {
    expect(counterSpell('fire')).toBe('water');
    expect(counterSpell('air')).toBe('earth');
    expect(counterSpell('steam')).toBe('steam');
    expect(counterSpell('ice')).toBe('magma');
    expect(counterSpell('magma')).toBe('ice');
  });
});
