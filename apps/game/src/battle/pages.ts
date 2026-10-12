import {
  quantizeStrokes,
  scorePage,
  SPELLS,
  spellById,
  type Element,
  type Page,
  type Point,
  type Recognizer,
  type SpellKey,
} from '@grimoire/glyphs';

/**
 * Keeps the most accurate drawing of each spell for the grimoire. A drawing is
 * scored after it is packed into the 24-point page format with the same check
 * the relayer runs, so every kept page passes the relayer.
 */
export class BestDrawings {
  private readonly best = new Map<SpellKey, Page>();

  constructor(
    private readonly recognizer: Recognizer<Element>,
    initial: readonly Page[] = [],
  ) {
    // Pages saved before a change of glyphs no longer read as their spell: they make room.
    for (const page of initial) {
      const spell = spellById(page.spellId);
      const check = spell ? scorePage(recognizer, spell.key, page) : null;
      if (spell && check?.ok) this.best.set(spell.key, { ...page, accuracy: Math.floor(check.accuracy) });
    }
  }

  /** Returns the new page when this drawing beats the stored one. */
  offer(spell: SpellKey, strokes: readonly Point[][], drawMs: number): Page | null {
    if (strokes.length !== SPELLS[spell].elements.length) return null;
    const packed = quantizeStrokes(strokes);
    const check = scorePage(this.recognizer, spell, packed);
    if (!check.ok) return null;
    const accuracy = Math.floor(check.accuracy);
    const current = this.best.get(spell);
    if (current && current.accuracy >= accuracy) return null;
    const page: Page = { spellId: SPELLS[spell].id, accuracy, drawMs, ...packed };
    this.best.set(spell, page);
    return page;
  }

  get(spell: SpellKey): Page | undefined {
    return this.best.get(spell);
  }

  pages(): Page[] {
    return [...this.best.values()].sort((a, b) => a.spellId - b.spellId);
  }
}
