import { describe, expect, it } from 'vitest';
import {
  decodePages,
  DEFAULT_TEMPLATES,
  encodePages,
  PAGE_BYTES,
  PAGE_POINTS,
  pageStrokes,
  quantizeStrokes,
  Recognizer,
  scorePage,
  scribble,
  seededRandom,
  SLOPPINESS,
  SPELLS,
  type Element,
  type Page,
  type Point,
} from '../src';

const recognizer = new Recognizer(DEFAULT_TEMPLATES);
const random = seededRandom(42);

function drawing(element: Element, offset = 0): Point[] {
  const template = DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points;
  return scribble(template, random, SLOPPINESS.neat).map((p) => ({ x: p.x + offset, y: p.y }));
}

function page(spellId: number, strokes: Point[][]): Page {
  return { spellId, accuracy: 88, drawMs: 640, ...quantizeStrokes(strokes) };
}

describe('quantizeStrokes', () => {
  it('fits a drawing into 24 points on the 0-255 grid, keeping proportions', () => {
    const wide = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }];
    const q = quantizeStrokes([wide]);
    expect(q.points).toHaveLength(PAGE_POINTS);
    expect(q.secondStroke).toBe(0);
    const xs = q.points.map((p) => p.x);
    const ys = q.points.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(255);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(51, -1);
    expect(Math.min(...ys)).toBeGreaterThan(90);
  });

  it('records where the second stroke starts', () => {
    const q = quantizeStrokes([drawing('fire'), drawing('water')]);
    expect(q.secondStroke).toBeGreaterThan(2);
    expect(pageStrokes(q)).toHaveLength(2);
  });
});

describe('encodePages / decodePages', () => {
  it('round-trips pages byte for byte', () => {
    const pages = [page(SPELLS.fire.id, [drawing('fire')]), page(SPELLS.steam.id, [drawing('fire'), drawing('water', 10)])];
    const bytes = encodePages(pages);
    expect(bytes).toHaveLength(4 + 2 * PAGE_BYTES);
    expect(decodePages(bytes)).toEqual(pages);
    expect(encodePages(decodePages(bytes))).toEqual(bytes);
  });

  it('refuses a block over the 700-byte limit', () => {
    const pages = Array.from({ length: 13 }, () => page(1, [drawing('fire')]));
    expect(() => encodePages(pages)).toThrow(/limit/);
  });

  it('rejects foreign, newer or truncated data', () => {
    const bytes = encodePages([page(1, [drawing('fire')])]);
    expect(() => decodePages(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a grimoire/);
    expect(() => decodePages(Uint8Array.from([...bytes.slice(0, 2), 2, ...bytes.slice(3)]))).toThrow(/format 2/);
    expect(() => decodePages(bytes.slice(0, 30))).toThrow(/truncated/);
  });
});

describe('scorePage', () => {
  it('accepts a drawing of the claimed spell', () => {
    const check = scorePage(recognizer, 'fire', quantizeStrokes([drawing('fire')]));
    expect(check.ok).toBe(true);
    expect(check.accuracy).toBeGreaterThanOrEqual(70);
  });

  it('rejects a drawing of another spell', () => {
    const check = scorePage(recognizer, 'fire', quantizeStrokes([drawing('water')]));
    expect(check).toMatchObject({ ok: false });
  });

  it('checks both strokes of a combination', () => {
    const steam = quantizeStrokes([drawing('fire'), drawing('water', 15)]);
    expect(scorePage(recognizer, 'steam', steam).ok).toBe(true);
    expect(scorePage(recognizer, 'ice', steam).ok).toBe(false);
    expect(scorePage(recognizer, 'fire', steam).ok).toBe(false);
  });

  it('rejects scribbles', () => {
    const r = seededRandom(3);
    const noise = Array.from({ length: 40 }, () => ({ x: r() * 100, y: r() * 100 }));
    expect(scorePage(recognizer, 'earth', quantizeStrokes([noise])).ok).toBe(false);
  });
});
