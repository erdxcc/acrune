import { DEFAULT_TEMPLATES, GLYPH_CANDIDATES, quantizeStrokes, Recognizer, scribble, seededRandom, SLOPPINESS, SPELLS, type Element, type Point } from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { BestDrawings } from './pages';

const recognizer = new Recognizer(DEFAULT_TEMPLATES);
const random = seededRandom(11);

function drawing(element: Element, sloppiness = SLOPPINESS.neat): Point[] {
  return scribble(DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points, random, sloppiness);
}

describe('BestDrawings', () => {
  it('keeps the most accurate drawing of each spell', () => {
    const best = new BestDrawings(recognizer);
    const first = best.offer('fire', [drawing('fire', SLOPPINESS.casual)], 500);
    expect(first?.spellId).toBe(SPELLS.fire.id);
    const perfect = DEFAULT_TEMPLATES.find((t) => t.glyph === 'fire')!.points.map((p) => ({ x: p.x * 90, y: p.y * 90 }));
    const better = best.offer('fire', [perfect], 400);
    expect(better!.accuracy).toBeGreaterThan(first!.accuracy);
    expect(best.offer('fire', [drawing('fire', SLOPPINESS.casual)], 300)).toBeNull();
    expect(best.get('fire')).toBe(better);
  });

  it('refuses drawings that do not match the spell', () => {
    const best = new BestDrawings(recognizer);
    expect(best.offer('fire', [drawing('water')], 400)).toBeNull();
    expect(best.offer('steam', [drawing('fire')], 400)).toBeNull();
    expect(best.pages()).toEqual([]);
  });

  it('stores combinations with both strokes and starts from saved pages', () => {
    const best = new BestDrawings(recognizer);
    const water = drawing('water').map((p) => ({ x: p.x + 10, y: p.y }));
    const steam = best.offer('steam', [drawing('fire'), water], 900);
    expect(steam?.secondStroke).toBeGreaterThan(0);
    const restored = new BestDrawings(recognizer, best.pages());
    expect(restored.get('steam')).toEqual(steam);
  });

  it('drops saved pages drawn with earlier glyphs', () => {
    const triangle = GLYPH_CANDIDATES.triangle.map((p) => ({ x: p.x * 90, y: p.y * 90 }));
    const old = { spellId: SPELLS.fire.id, accuracy: 97, drawMs: 400, ...quantizeStrokes([triangle]) };
    const best = new BestDrawings(recognizer, [old]);
    expect(best.get('fire')).toBeUndefined();
    expect(best.offer('fire', [drawing('fire', SLOPPINESS.casual)], 500)).not.toBeNull();
  });
});
