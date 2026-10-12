import { describe, expect, it } from 'vitest';
import { BALANCE, battleDef, enemyDef, SPELL_DEFS, type BattleDef, type EnemyDef } from '../content';
import { BattleSim, type SimContent, type SimEvent } from './sim';

function content(overrides: Record<string, Partial<EnemyDef>> = {}, balance = BALANCE): SimContent {
  return {
    balance,
    spells: SPELL_DEFS,
    enemy: (key) => ({ ...enemyDef(key), ...overrides[key] }),
  };
}

function battle(...waves: string[][]): BattleDef {
  return { id: 'test', name: 'Test', brief: '', background: '', waves: waves.map((w) => ({ spawns: w.map((enemy) => ({ enemy, delay: 0, wait: 0 })) })) };
}

function events(sim: BattleSim, type: SimEvent['type']): SimEvent[] {
  return sim.drainEvents().filter((e) => e.type === type);
}

/** Steps until `done` or the time limit; returns whether `done` became true. */
function runUntil(sim: BattleSim, done: () => boolean, seconds = 60): boolean {
  for (let i = 0; i < seconds * 60 && sim.status === 'running'; i++) {
    if (done()) return true;
    sim.step();
  }
  return done();
}

describe('BattleSim basics', () => {
  it('walks a monster up to the hero and lets it hit in melee', () => {
    const sim = new BattleSim(battle(['tide_husk']), content(), 1);
    sim.advance(14);
    expect(sim.enemies[0]!.x).toBeCloseTo(enemyDef('tide_husk').stopAt, 0);
    expect(sim.hero.hp).toBeLessThan(BALANCE.hero.hp);
  });

  it('spends mana on a cast and refuses when mana is short', () => {
    const sim = new BattleSim(battle(['tide_husk']), content(), 1);
    sim.step();
    expect(sim.cast('fire', 'normal').kind).toBe('attack');
    expect(sim.hero.mana).toBeCloseTo(BALANCE.hero.mana - SPELL_DEFS.fire.mana, 0);
    sim.hero.mana = 1;
    expect(sim.cast('fire', 'normal').kind).toBe('noMana');
    expect(sim.hero.mana).toBe(1);
  });

  it('spends no mana on an unrecognised drawing', () => {
    const sim = new BattleSim(battle(['tide_husk']), content(), 1);
    sim.step();
    const before = sim.hero.mana;
    sim.cast('fire', 'failed');
    expect(sim.hero.mana).toBe(before);
    expect(sim.stats.fizzles).toBe(1);
    expect(sim.stats.casts).toBe(0);
  });

  it('doubles damage on a weakness and halves it on a resistance', () => {
    const hitDamage = (enemy: string) => {
      const sim = new BattleSim(battle([enemy]), content(), 1);
      sim.step();
      sim.cast('fire', 'normal');
      sim.advance(2);
      return (sim.drainEvents().find((e) => e.type === 'hit') as Extract<SimEvent, { type: 'hit' }>).damage;
    };
    expect(hitDamage('tide_husk')).toBeCloseTo(SPELL_DEFS.fire.damage * BALANCE.element.weak);
    expect(hitDamage('ember_husk')).toBeCloseTo(SPELL_DEFS.fire.damage * BALANCE.element.resist);
    expect(hitDamage('gust_husk')).toBeCloseTo(SPELL_DEFS.fire.damage);
  });

  it('makes precise casts stronger and sloppy casts able to hurt the hero', () => {
    const sloppyAlways = { ...BALANCE, accuracy: { ...BALANCE.accuracy, sloppy: { ...BALANCE.accuracy.sloppy, backfireChance: 1 } } };
    const sim = new BattleSim(battle(['gust_husk']), content({}, sloppyAlways), 1);
    sim.step();
    sim.cast('fire', 'sloppy');
    expect(sim.hero.hp).toBeCloseTo(BALANCE.hero.hp - SPELL_DEFS.fire.damage * sloppyAlways.accuracy.sloppy.backfireShare);
    expect(sim.stats.backfires).toBe(1);

    const precise = new BattleSim(battle(['gust_husk']), content(), 1);
    precise.step();
    precise.cast('fire', 'precise');
    precise.advance(2);
    const hit = precise.drainEvents().find((e) => e.type === 'hit') as Extract<SimEvent, { type: 'hit' }>;
    expect(hit.damage).toBeCloseTo(SPELL_DEFS.fire.damage * BALANCE.accuracy.precise.power);
    expect(precise.stats.precise).toBe(1);
  });

  it('is deterministic for a seed', () => {
    const play = (seed: number) => {
      const sim = new BattleSim(battleDef('c1-b2'), content(), seed);
      for (let t = 0; t < 90 && sim.status === 'running'; t++) {
        sim.cast(t % 2 ? 'water' : 'fire', 'sloppy');
        sim.advance(1);
      }
      return [sim.time, sim.hero.hp, sim.stats.backfires, sim.status];
    };
    expect(play(5)).toEqual(play(5));
  });
});

describe('parrying', () => {
  it('lets the hero parry an enemy cast with the opposite element during the wind-up', () => {
    const sim = new BattleSim(battle(['fire_adept']), content(), 1);
    expect(runUntil(sim, () => sim.enemies[0]?.state === 'windup')).toBe(true);
    expect(sim.cast('fire', 'normal').kind).toBe('attack');
    expect(sim.enemies[0]!.state).toBe('windup');
    const parry = sim.cast('water', 'normal');
    expect(parry.kind).toBe('parry');
    expect(sim.enemies[0]!.state).toBe('ready');
    expect(sim.stats.parries).toBe(1);
  });

  it('parries a spell already in flight', () => {
    const sim = new BattleSim(battle(['fire_adept']), content(), 1);
    expect(runUntil(sim, () => sim.projectiles.some((p) => p.from === 'enemy'))).toBe(true);
    expect(sim.cast('water', 'normal').kind).toBe('parry');
    expect(sim.projectiles.some((p) => p.from === 'enemy')).toBe(false);
    sim.advance(3);
    expect(sim.drainEvents().some((e) => e.type === 'heroHit')).toBe(false);
  });

  it('parries the attack that would land first', () => {
    const sim = new BattleSim(battle(['fire_adept', 'fire_adept']), content(), 1);
    const bothWindingUp = () => sim.enemies.length === 2 && sim.enemies.every((e) => e.state === 'windup');
    expect(runUntil(sim, bothWindingUp)).toBe(true);
    const sooner = sim.incomingAttacks().sort((a, b) => a.timeToHit - b.timeToHit)[0]!;
    expect(sim.cast('water', 'normal')).toEqual({ kind: 'parry', enemyId: sooner.enemyId });
    expect(sim.enemies.filter((e) => e.state === 'windup').map((e) => e.id)).not.toContain(sooner.enemyId);
  });

  it('lets a mage parry a player spell it holds the counter for', () => {
    const sure = content({ fire_adept: { parryChance: 1 } });
    const sim = new BattleSim(battle(['fire_adept']), sure, 1);
    sim.step();
    sim.cast('water', 'normal');
    sim.advance(3);
    expect(events(sim, 'enemyParry')).toHaveLength(1);

    const other = new BattleSim(battle(['fire_adept']), sure, 1);
    other.step();
    other.cast('air', 'normal');
    other.advance(3);
    expect(events(other, 'hit')).toHaveLength(1);
  });

  it('does not parry with a spell that is not the counter', () => {
    const sim = new BattleSim(battle(['fire_adept']), content(), 1);
    runUntil(sim, () => sim.enemies[0]?.state === 'windup');
    expect(sim.cast('earth', 'normal').kind).toBe('attack');
  });
});

describe('waves and outcome', () => {
  it('wins the first battle with steady precise fire', () => {
    const sim = new BattleSim(battleDef('c1-b1'), content(), 3);
    const waves: number[] = [];
    for (let t = 0; t < 480 && sim.status === 'running'; t++) {
      if (t % 6 === 0) sim.cast('fire', 'precise');
      sim.advance(1 / 4);
      for (const e of sim.drainEvents()) if (e.type === 'wave') waves.push(e.index);
    }
    expect(sim.status).toBe('won');
    expect(waves).toEqual(battleDef('c1-b1').waves.map((_, i) => i));
  });

  it('sends the enemies of a battle out one at a time', () => {
    const sim = new BattleSim(battleDef('c1-b1'), content(), 3);
    let spawns = 0;
    let most = 0;
    for (let t = 0; t < 480 && sim.status === 'running'; t++) {
      if (t % 6 === 0) sim.cast('fire', 'precise');
      sim.advance(1 / 4);
      spawns += events(sim, 'spawn').length;
      most = Math.max(most, sim.enemies.length);
    }
    expect(sim.status).toBe('won');
    expect(spawns).toBe(3);
    expect(most).toBe(1);
  });

  it('lets a standing enemy act only once it has come out to its post', () => {
    const sim = new BattleSim(battle(['slime_mage']), content(), 1);
    expect(runUntil(sim, () => sim.enemies[0]?.state === 'windup', 10)).toBe(true);
    expect(sim.time).toBeGreaterThanOrEqual(BALANCE.entrance);
  });

  it('queues enemies that enter together instead of stacking them', () => {
    const sim = new BattleSim(battle(['tide_husk', 'tide_husk']), content(), 1);
    sim.step();
    const [a, b] = sim.enemies;
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThanOrEqual(a!.def.size + b!.def.size);
    sim.advance(20);
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThanOrEqual(a!.def.size + b!.def.size - 0.01);
  });

  it('loses when the hero falls', () => {
    const sim = new BattleSim(battle(['tide_husk', 'tide_husk', 'tide_husk']), content(), 1);
    sim.advance(120);
    expect(sim.status).toBe('lost');
    expect(sim.hero.hp).toBe(0);
  });
});

describe('boss', () => {
  it('changes vulnerability between phases and is immune while transforming', () => {
    const sim = new BattleSim(battle(['gate_warden']), content(), 1);
    sim.step();
    const boss = sim.enemies[0]!;
    expect(sim.affinity(boss, 'water')).toBe('weak');
    expect(sim.affinity(boss, 'air')).toBe('normal');
    boss.hp = boss.maxHp * 0.52;
    sim.cast('water', 'precise');
    expect(runUntil(sim, () => boss.phase === 1, 10)).toBe(true);
    expect(boss.state).toBe('transition');
    expect(sim.affinity(boss, 'air')).toBe('immune');
    sim.advance(2);
    expect(sim.affinity(boss, 'air')).toBe('weak');
    expect(sim.affinity(boss, 'water')).toBe('resist');
  });

  it('summons minions and takes them along when it dies', () => {
    const warden = enemyDef('gate_warden');
    const summoner = content({ gate_warden: { phases: warden.phases.map((p) => ({ ...p, summon: { enemy: 'ember_husk', every: 6, max: 2 } })) } });
    const sim = new BattleSim(battle(['gate_warden']), summoner, 1);
    sim.advance(20);
    expect(sim.enemies.filter((e) => e.summonerId !== null).length).toBeGreaterThan(0);
    const boss = sim.enemies.find((e) => e.def.kind === 'boss')!;
    boss.hp = 1;
    boss.burns.push({ dps: 100, left: 1 });
    sim.advance(1);
    expect(sim.enemies).toHaveLength(0);
    expect(sim.status).toBe('won');
  });
});
