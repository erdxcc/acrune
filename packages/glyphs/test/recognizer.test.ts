import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  DEFAULT_THRESHOLDS,
  ELEMENTS,
  GLYPH_CANDIDATES,
  levelOf,
  Recognizer,
  SLOPPINESS,
  scribble,
  seededRandom,
  type Element,
  type Sloppiness,
} from '../src';

const recognizer = new Recognizer(DEFAULT_TEMPLATES);

function templateOf(element: Element) {
  return DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points;
}

function trial(sloppiness: Sloppiness, perGlyph: number, seed = 7) {
  const random = seededRandom(seed);
  let wrong = 0;
  let total = 0;
  const scores: number[] = [];
  for (const element of ELEMENTS) {
    for (let i = 0; i < perGlyph; i++) {
      const r = recognizer.recognize(scribble(templateOf(element), random, sloppiness));
      total++;
      if (r.glyph !== element) wrong++;
      else scores.push(r.score);
    }
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { wrongRate: wrong / total, mean };
}

describe('Recognizer', () => {
  it('reads every template as its own glyph with a top score', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const r = recognizer.recognize(t.points);
      expect(r.glyph).toBe(t.glyph);
      expect(r.score).toBeGreaterThan(99);
      expect(r.level).toBe('precise');
    }
  });

  it('ignores size, position and drawing direction', () => {
    const moved = GLYPH_CANDIDATES.step.map((p) => ({ x: 300 + p.x * 40, y: 50 + p.y * 40 })).reverse();
    expect(recognizer.recognize(moved)).toMatchObject({ glyph: 'fire', level: 'precise' });
  });

  it('treats orientation as part of the glyph', () => {
    const upright = recognizer.recognize(GLYPH_CANDIDATES.step).score;
    const flipped = recognizer.recognize(GLYPH_CANDIDATES.step.map((p) => ({ x: p.x, y: 1 - p.y })));
    expect(flipped.score).toBeLessThan(upright - 25);
    expect(flipped.level).not.toBe('precise');
  });

  it('rejects strokes shorter than minPathLength', () => {
    const strict = new Recognizer(DEFAULT_TEMPLATES, { minPathLength: 30 });
    const tiny = GLYPH_CANDIDATES.step.map((p) => ({ x: p.x * 5, y: p.y * 5 }));
    expect(strict.recognize(tiny)).toMatchObject({ glyph: null, level: 'failed' });
    expect(strict.recognize([{ x: 1, y: 1 }])).toMatchObject({ glyph: null, level: 'failed' });
  });

  it('only compares the glyphs it is asked about', () => {
    const r = recognizer.recognize(GLYPH_CANDIDATES.step, ['water', 'air']);
    expect(r.ranking.map((g) => g.glyph).sort()).toEqual(['air', 'water']);
  });

  it('does not read a lone straight line as a glyph', () => {
    const line = (x1: number, y1: number) => Array.from({ length: 21 }, (_, i) => ({ x: (x1 * i) / 20, y: (y1 * i) / 20 }));
    for (const stroke of [line(0, 100), line(100, 0), line(100, -100)]) expect(recognizer.recognize(stroke).level).toBe('failed');
  });

  it('reads neat synthetic drawings without confusion', () => {
    expect(trial(SLOPPINESS.neat, 100).wrongRate).toBeLessThanOrEqual(0.005);
  });

  it('confuses fewer than 2% of casual synthetic drawings', () => {
    expect(trial(SLOPPINESS.casual, 100).wrongRate).toBeLessThan(0.02);
  });

  it('scores neat drawings above messy ones', () => {
    expect(trial(SLOPPINESS.neat, 40).mean).toBeGreaterThan(trial(SLOPPINESS.messy, 40).mean + 10);
  });
});

describe('levelOf', () => {
  const t = DEFAULT_THRESHOLDS;

  it('maps scores to the four levels', () => {
    expect(levelOf(90, 0, t)).toBe('precise');
    expect(levelOf(75, 0, t)).toBe('normal');
    expect(levelOf(60, 0, t)).toBe('sloppy');
    expect(levelOf(40, 0, t)).toBe('failed');
  });

  it('drops one level when the runner-up is too close', () => {
    expect(levelOf(90, 85, t)).toBe('normal');
    expect(levelOf(60, 55, t)).toBe('failed');
    expect(levelOf(90, 82, t)).toBe('precise');
  });
});
