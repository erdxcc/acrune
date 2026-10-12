import { z } from 'zod';

/**
 * Shape of the game content. Designers edit the numbers in spells.ts,
 * enemies.ts, battles.ts and balance.ts; index.ts validates them on load.
 * Distances are in field units: the hero stands at 0, enemies enter at
 * `balance.field.length`.
 */

export const elementSchema = z.enum(['fire', 'water', 'air', 'earth']);
export const spellKeySchema = z.enum(['fire', 'water', 'air', 'earth', 'steam', 'ice', 'magma']);

export const effectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('burn'), dps: z.number().positive(), duration: z.number().positive() }),
  z.object({ kind: z.literal('slow'), factor: z.number().min(0).max(1), duration: z.number().positive() }),
  z.object({ kind: z.literal('stun'), duration: z.number().positive() }),
  z.object({ kind: z.literal('knockback'), distance: z.number().positive() }),
  z.object({ kind: z.literal('area'), radius: z.number().positive(), share: z.number().min(0).max(1) }),
]);

export const spellSchema = z.object({
  key: spellKeySchema,
  name: z.string(),
  damage: z.number().nonnegative(),
  mana: z.number().nonnegative(),
  /** Grimoire pages the spell takes in the battle set. */
  pages: z.number().int().positive(),
  /** Projectile speed, units per second. */
  speed: z.number().positive(),
  effects: z.array(effectSchema),
  /** Effect line on the spell card. */
  text: z.string(),
});

const defence = {
  weak: z.array(elementSchema),
  resist: z.array(elementSchema),
  immune: z.array(elementSchema).default([]),
};

export const castSchema = z.object({
  /** Spells cast in turn. */
  spells: z.array(spellKeySchema).min(1),
  /** Sparks over the staff, seconds. This is the player's parry window. */
  windup: z.number().positive(),
  /** Pause between casts, seconds. */
  cooldown: z.number().nonnegative(),
  damage: z.number().positive(),
  speed: z.number().positive(),
});

export const meleeSchema = z.object({
  damage: z.number().positive(),
  interval: z.number().positive(),
});

export const phaseSchema = z.object({
  /** The phase starts when HP falls below this share of max HP. */
  below: z.number().min(0).max(1),
  ...defence,
  cast: castSchema.optional(),
  summon: z.object({ enemy: z.string(), every: z.number().positive(), max: z.number().int().positive() }).optional(),
  /** Invulnerable transformation before the phase, seconds. */
  transition: z.number().nonnegative().default(1.5),
});

export const enemySchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.enum(['monster', 'mage', 'boss']),
  /** Asset key of the sprite set. */
  sprite: z.string(),
  element: elementSchema.nullable(),
  hp: z.number().positive(),
  /** Walking speed; 0 means the enemy stands at `stopAt` from the start. */
  speed: z.number().nonnegative(),
  /** Half-width used to keep enemies from overlapping. */
  size: z.number().positive(),
  /** Distance from the hero where the enemy stops walking (or stands). */
  stopAt: z.number().nonnegative(),
  ...defence,
  melee: meleeSchema.optional(),
  cast: castSchema.optional(),
  /** Chance to parry a player spell it has the counter for. */
  parryChance: z.number().min(0).max(1).default(0),
  phases: z.array(phaseSchema).default([]),
});

export const battleSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line shown on the preparation screen. */
  brief: z.string(),
  background: z.string(),
  waves: z
    .array(
      z.object({
        spawns: z
          .array(
            z.object({
              enemy: z.string(),
              delay: z.number().nonnegative(),
              /** Extra seconds before its first cast, so a group does not cast all at once. */
              wait: z.number().nonnegative().default(0),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const balanceSchema = z.object({
  hero: z.object({ hp: z.number().positive(), mana: z.number().positive(), manaRegen: z.number().nonnegative() }),
  accuracy: z.object({
    precise: z.object({ power: z.number().positive() }),
    normal: z.object({ power: z.number().positive() }),
    sloppy: z.object({
      power: z.number().positive(),
      /** Chance that unstable magic also hurts the hero. */
      backfireChance: z.number().min(0).max(1),
      /** Share of the spell's damage the hero takes on a backfire. */
      backfireShare: z.number().min(0),
    }),
  }),
  element: z.object({ weak: z.number().nonnegative(), resist: z.number().nonnegative(), immune: z.number().nonnegative() }),
  field: z.object({ length: z.number().positive() }),
  /** Pause between waves, seconds. */
  wavePause: z.number().nonnegative(),
  /** Seconds a standing enemy takes to come out to its post; it acts only after. */
  entrance: z.number().nonnegative(),
  /** How long after lifting the finger a second stroke may start to form a combination. */
  comboWindowMs: z.number().nonnegative(),
});

export type Effect = z.infer<typeof effectSchema>;
export type SpellDef = z.infer<typeof spellSchema>;
export type CastDef = z.infer<typeof castSchema>;
export type PhaseDef = z.infer<typeof phaseSchema>;
export type EnemyDef = z.infer<typeof enemySchema>;
export type BattleDef = z.infer<typeof battleSchema>;
export type Balance = z.infer<typeof balanceSchema>;
