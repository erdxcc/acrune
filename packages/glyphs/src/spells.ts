/**
 * Spell identity shared by the game and the relayer. Balance numbers (damage,
 * mana, effects, page cost) live in the game's content folder.
 */

export type Element = 'fire' | 'water' | 'air' | 'earth';

export const ELEMENTS: readonly Element[] = ['fire', 'water', 'air', 'earth'];

export const OPPOSITE: Readonly<Record<Element, Element>> = {
  fire: 'water',
  water: 'fire',
  air: 'earth',
  earth: 'air',
};

export type SpellKey = 'fire' | 'water' | 'air' | 'earth' | 'steam' | 'ice' | 'magma';

export interface SpellIdentity {
  key: SpellKey;
  /** Byte stored on-chain: 1-4 elements, 11+ combinations. */
  id: number;
  /** One element, or two for a combination. */
  elements: readonly Element[];
}

export const SPELLS: Readonly<Record<SpellKey, SpellIdentity>> = {
  fire: { key: 'fire', id: 1, elements: ['fire'] },
  water: { key: 'water', id: 2, elements: ['water'] },
  air: { key: 'air', id: 3, elements: ['air'] },
  earth: { key: 'earth', id: 4, elements: ['earth'] },
  steam: { key: 'steam', id: 11, elements: ['fire', 'water'] },
  ice: { key: 'ice', id: 12, elements: ['water', 'air'] },
  magma: { key: 'magma', id: 13, elements: ['fire', 'earth'] },
};

export const SPELL_KEYS = Object.keys(SPELLS) as SpellKey[];

export function spellById(id: number): SpellIdentity | undefined {
  return SPELL_KEYS.map((k) => SPELLS[k]).find((s) => s.id === id);
}

export function isCombo(key: SpellKey): boolean {
  return SPELLS[key].elements.length > 1;
}

function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  return a.length === b.length && a.every((e) => b.includes(e)) && b.every((e) => a.includes(e));
}

/** The spell made of exactly these elements, in any order. */
export function spellOfElements(elements: readonly Element[]): SpellKey | undefined {
  return SPELL_KEYS.find((k) => sameElements(SPELLS[k].elements, elements));
}

/**
 * The spell that parries `key`: the opposite element, or for a combination the
 * combination of the opposites (steam parries steam, ice and magma parry each other).
 */
export function counterSpell(key: SpellKey): SpellKey | undefined {
  return spellOfElements(SPELLS[key].elements.map((e) => OPPOSITE[e]));
}
