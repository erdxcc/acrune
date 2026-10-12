import { SPELLS, type Element, type SpellKey } from '@grimoire/glyphs';

export const FONT = '"Press Start 2P", monospace';
export const HEIGHT = 360;

export const PALETTE = {
  night: 0x141019,
  ink: 0x221a2e,
  inkLight: 0x3a2d4a,
  parchment: 0xe9dcb8,
  parchmentShade: 0xcdb98c,
  parchmentLine: 0x8a7350,
  gold: 0xe0b44c,
  hp: 0xd94b4b,
  mana: 0x4a8fe0,
  text: 0xf3ead2,
  dim: 0x9a8fae,
  dark: 0x2a2133,
  good: 0x7bd36a,
  bad: 0xe0614f,
};

/** Element colours from the concept. Shapes differ too, so colour-blind players can tell them apart. */
export const ELEMENT_COLOR: Readonly<Record<Element, number>> = {
  fire: 0xe8553e,
  water: 0x3f86e8,
  air: 0x6cc35a,
  earth: 0xc99a3b,
};

export function spellColors(spell: SpellKey): number[] {
  return SPELLS[spell].elements.map((e) => ELEMENT_COLOR[e]);
}

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function textStyle(size = 8, color: number = PALETTE.text, wrap?: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color: css(color),
    lineSpacing: Math.round(size / 2),
    ...(wrap ? { wordWrap: { width: wrap } } : {}),
  };
}
