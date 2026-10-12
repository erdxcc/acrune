import { BATTLES, SPELL_KEYS } from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { BATTLE_DEFS, ENEMY_DEFS, SPELL_DEFS } from '.';

describe('content', () => {
  it('has a battle for every chapter step and balance for every spell', () => {
    expect(BATTLE_DEFS.map((b) => b.id)).toEqual(BATTLES.map((b) => b.id));
    for (const key of SPELL_KEYS) expect(SPELL_DEFS[key].key).toBe(key);
  });

  it('only puts spells into a battle set that fit its page limit somehow', () => {
    for (const battle of BATTLES) {
      const cheapest = Math.min(...battle.unlocks.map((k) => SPELL_DEFS[k].pages));
      expect(cheapest).toBeLessThanOrEqual(battle.pageLimit);
    }
  });

  it('gives every enemy cast a counter the player can learn', () => {
    for (const enemy of Object.values(ENEMY_DEFS)) {
      const casts = [enemy.cast, ...enemy.phases.map((p) => p.cast)].flatMap((c) => c?.spells ?? []);
      for (const spell of casts) expect(SPELL_KEYS).toContain(spell);
    }
  });
});
