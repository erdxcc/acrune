import { BATTLES, counterSpell, type AccuracyLevel, type SpellKey } from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { BALANCE, battleDef, enemyDef, SPELL_DEFS } from '../content';
import { BattleSim, type Affinity } from './sim';

/**
 * Plays every battle of the chapter with a simple player: parry when it can,
 * otherwise hit the nearest enemy with its best affinity. Guards the balance
 * against changes that make a battle unwinnable or trivial.
 */

const RANK: Record<Affinity, number> = { weak: 0, normal: 1, resist: 2, immune: 3 };

/** The set the preparation screen offers by default: this battle's new spells first. */
function defaultSet(battleId: string): SpellKey[] {
  const battle = BATTLES.find((b) => b.id === battleId)!;
  const known = BATTLES.filter((b) => b.order <= battle.order).flatMap((b) => b.unlocks);
  const set: SpellKey[] = [];
  let pages = 0;
  for (const spell of [...battle.unlocks, ...known]) {
    if (set.includes(spell) || pages + SPELL_DEFS[spell].pages > battle.pageLimit) continue;
    set.push(spell);
    pages += SPELL_DEFS[spell].pages;
  }
  return set;
}

function act(sim: BattleSim, set: SpellKey[], level: AccuracyLevel): void {
  const incoming = sim.incomingAttacks().sort((a, b) => a.timeToHit - b.timeToHit)[0];
  const counter = incoming ? counterSpell(incoming.spell) : undefined;
  if (counter && set.includes(counter) && sim.hero.mana >= SPELL_DEFS[counter].mana) {
    sim.cast(counter, level);
    return;
  }
  const target = sim.nearestEnemy();
  if (!target) return;
  const choice = [...set].sort((a, b) => RANK[sim.affinity(target, a)] - RANK[sim.affinity(target, b)] || SPELL_DEFS[b].damage - SPELL_DEFS[a].damage)[0]!;
  if (sim.hero.mana >= SPELL_DEFS[choice].mana) sim.cast(choice, level);
}

function play(battleId: string, level: AccuracyLevel, seed = 11) {
  const sim = new BattleSim(battleDef(battleId), { balance: BALANCE, spells: SPELL_DEFS, enemy: enemyDef }, seed);
  const set = defaultSet(battleId);
  for (let t = 0; t < 300 * 4 && sim.status === 'running'; t++) {
    act(sim, set, level);
    sim.advance(0.25);
  }
  return { status: sim.status, time: Math.round(sim.time), hp: Math.round(sim.hero.hp), parries: sim.stats.parries, set };
}

describe('chapter balance', () => {
  for (const battle of BATTLES) {
    it(`${battle.id} can be won by a steady player`, () => {
      const result = play(battle.id, 'normal');
      console.log(battle.id, result);
      expect(result.status).toBe('won');
      // Long enough for the relayer's minimum duration, short enough to stay snappy.
      expect(result.time).toBeGreaterThanOrEqual(battle.minDurationSec);
      expect(result.time).toBeLessThan(180);
    });
  }

  it('punishes doing nothing', () => {
    const sim = new BattleSim(battleDef('c1-b1'), { balance: BALANCE, spells: SPELL_DEFS, enemy: enemyDef }, 1);
    sim.advance(180);
    expect(sim.status).toBe('lost');
  });
});
