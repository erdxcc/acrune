import type { z } from 'zod';
import type { enemySchema } from './schema';

type EnemyInput = z.input<typeof enemySchema>;

/** One monster drawn once and recoloured per element (palette swap). */
function husk(key: string, name: string, element: 'fire' | 'water' | 'air' | 'earth', weak: EnemyInput['weak']): EnemyInput {
  return {
    key,
    name,
    kind: 'monster',
    sprite: `monster_${element}`,
    element,
    hp: 40,
    speed: 8,
    // Half-width in field units; matches the sprite at its display scale.
    size: 6.5,
    stopAt: 9,
    weak,
    resist: [element],
    melee: { damage: 7, interval: 1.3 },
  };
}

function adept(key: string, name: string, element: 'fire' | 'water' | 'air' | 'earth', weak: EnemyInput['weak']): EnemyInput {
  return {
    key,
    name,
    kind: 'mage',
    sprite: `mage_${element}`,
    element,
    hp: 56,
    speed: 8,
    size: 7,
    stopAt: 55,
    weak,
    resist: [element],
    cast: { spells: [element], windup: 2.0, cooldown: 2.5, damage: 12, speed: 80 },
    parryChance: 0.3,
  };
}

/**
 * A duelist comes out to its post and fights from there at range: every attack is a cast the
 * player can parry with the opposite element. Battles send them out one at a time.
 */
function duelist(
  key: string,
  name: string,
  sprite: string,
  element: 'fire' | 'water' | 'air' | 'earth',
  weak: EnemyInput['weak'],
  hp: number,
  cast: NonNullable<EnemyInput['cast']>,
  parryChance: number,
): EnemyInput {
  return { key, name, kind: 'mage', sprite, element, hp, speed: 0, size: 9, stopAt: 78, weak, resist: [element], cast, parryChance };
}

export const enemies: EnemyInput[] = [
  // The first enemies are gentle: long wind-ups to learn the parry, light hits.
  duelist('slime_mage', 'Slime Mage', 'slime_mage', 'water', ['fire'], 110, { spells: ['water'], windup: 3.0, cooldown: 4.5, damage: 6, speed: 50 }, 0),
  duelist('skeleton_mage', 'Skeleton Mage', 'skeleton_mage', 'fire', ['water'], 200, { spells: ['fire'], windup: 2.4, cooldown: 3.5, damage: 9, speed: 60 }, 0.15),
  duelist('skeleton', 'Skeleton', 'skeleton', 'air', ['earth'], 180, { spells: ['air'], windup: 2.0, cooldown: 3.0, damage: 10, speed: 70 }, 0.15),
  // Walking enemies of the first prototype; the battle tests still use them.
  husk('ember_husk', 'Ember Husk', 'fire', ['water']),
  husk('tide_husk', 'Tide Husk', 'water', ['fire']),
  husk('gust_husk', 'Gust Husk', 'air', ['earth']),
  husk('clay_husk', 'Clay Husk', 'earth', ['air']),
  adept('fire_adept', 'Fire Adept', 'fire', ['water']),
  adept('tide_adept', 'Tide Adept', 'water', ['fire']),
  adept('gale_adept', 'Gale Adept', 'air', ['earth']),
  adept('stone_adept', 'Stone Adept', 'earth', ['air']),
  {
    key: 'gate_warden',
    name: 'Warden of the Gate',
    kind: 'boss',
    sprite: 'boss',
    element: null,
    hp: 520,
    speed: 0,
    size: 11,
    stopAt: 76,
    weak: [],
    resist: [],
    phases: [
      {
        below: 1,
        weak: ['water'],
        resist: ['fire'],
        cast: { spells: ['fire', 'air'], windup: 1.4, cooldown: 2.4, damage: 12, speed: 90 },
        transition: 0,
      },
      {
        below: 0.5,
        weak: ['air'],
        resist: ['earth', 'water'],
        cast: { spells: ['earth', 'ice'], windup: 1.4, cooldown: 2.2, damage: 14, speed: 90 },
        transition: 1.5,
      },
    ],
  },
];
