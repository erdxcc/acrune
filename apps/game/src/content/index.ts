import { BATTLES, SPELL_KEYS, type SpellKey } from '@grimoire/glyphs';
import { balance } from './balance';
import { battles } from './battles';
import { enemies } from './enemies';
import {
  balanceSchema,
  battleSchema,
  enemySchema,
  spellSchema,
  type Balance,
  type BattleDef,
  type EnemyDef,
  type SpellDef,
} from './schema';
import { spells } from './spells';

export * from './schema';

function fail(message: string): never {
  throw new Error(`content: ${message}`);
}

export const BALANCE: Balance = balanceSchema.parse(balance);

export const SPELL_DEFS = Object.fromEntries(spells.map((s) => [s.key, spellSchema.parse(s)])) as Record<SpellKey, SpellDef>;

export const ENEMY_DEFS: Readonly<Record<string, EnemyDef>> = Object.fromEntries(
  enemies.map((e) => [e.key, enemySchema.parse(e)]),
);

export const BATTLE_DEFS: readonly BattleDef[] = battles.map((b) => battleSchema.parse(b));

export function enemyDef(key: string): EnemyDef {
  return ENEMY_DEFS[key] ?? fail(`unknown enemy "${key}"`);
}

export function battleDef(id: string): BattleDef {
  return BATTLE_DEFS.find((b) => b.id === id) ?? fail(`unknown battle "${id}"`);
}

// Cross-references the schemas cannot express. Failing here shows a broken
// edit as soon as the game loads.
for (const key of SPELL_KEYS) if (!SPELL_DEFS[key]) fail(`spell "${key}" has no balance entry`);
for (const progress of BATTLES) battleDef(progress.id);
for (const battle of BATTLE_DEFS) {
  for (const wave of battle.waves) for (const spawn of wave.spawns) enemyDef(spawn.enemy);
}
for (const enemy of Object.values(ENEMY_DEFS)) {
  for (const phase of enemy.phases) if (phase.summon) enemyDef(phase.summon.enemy);
  if (enemy.kind === 'boss' && enemy.phases.length === 0) fail(`boss "${enemy.key}" has no phases`);
  if (enemy.kind === 'mage' && !enemy.cast) fail(`mage "${enemy.key}" has no cast`);
  if (enemy.kind === 'monster' && !enemy.melee) fail(`monster "${enemy.key}" has no melee attack`);
}
