import { pageStrokes, type Page } from './codec';
import type { Recognizer } from './recognizer';
import { SPELLS, type Element, type SpellKey } from './spells';

/** A stored drawing must match its spell with at least this score. */
export const PAGE_MIN_ACCURACY = 70;

export type PageCheck = { ok: true; accuracy: number } | { ok: false; accuracy: number; reason: string };

/**
 * Re-recognises a stored drawing. Every stroke must be read as one of the
 * spell's elements, together covering all of them; the page accuracy is the
 * lowest stroke score. The game and the relayer both use this, so a page the
 * game accepts is a page the relayer accepts.
 */
export function scorePage(
  recognizer: Recognizer<Element>,
  spell: SpellKey,
  page: Pick<Page, 'points' | 'secondStroke'>,
): PageCheck {
  const expected = SPELLS[spell].elements;
  const strokes = pageStrokes(page);
  if (strokes.length !== expected.length) {
    return { ok: false, accuracy: 0, reason: `expected ${expected.length} stroke(s), got ${strokes.length}` };
  }
  const results = strokes.map((s) => recognizer.recognize(s));
  const glyphs = results.map((r) => r.glyph);
  const coversAll = expected.every((e) => glyphs.includes(e)) && glyphs.every((g) => g !== null && expected.includes(g));
  const accuracy = Math.min(...results.map((r) => r.score));
  if (!coversAll) return { ok: false, accuracy, reason: `drawing reads as ${glyphs.join('+')}, not ${spell}` };
  if (accuracy < PAGE_MIN_ACCURACY) return { ok: false, accuracy, reason: `accuracy ${accuracy.toFixed(1)} is below ${PAGE_MIN_ACCURACY}` };
  return { ok: true, accuracy };
}
