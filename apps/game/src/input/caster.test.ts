import { DEFAULT_TEMPLATES, Recognizer, type Element, type Point, type SpellKey } from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { GlyphCaster, worseLevel } from './caster';

const recognizer = new Recognizer(DEFAULT_TEMPLATES);

function glyph(element: Element, dx = 0): Point[] {
  return DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points.map((p) => ({ x: dx + p.x * 100, y: p.y * 100 }));
}

function caster(set: SpellKey[]) {
  return new GlyphCaster(recognizer, set, 300);
}

describe('GlyphCaster', () => {
  it('fires an element on lift when no combination uses it', () => {
    const c = caster(['fire', 'water']);
    c.strokeStart(0);
    expect(c.strokeEnd(glyph('fire'), 400, 400)).toMatchObject([{ kind: 'spell', spell: 'fire', level: 'precise' }]);
    expect(c.waiting).toBe(false);
  });

  it('waits for a second stroke when a combination is in the set, then fires alone', () => {
    const c = caster(['fire', 'steam']);
    c.strokeStart(0);
    expect(c.strokeEnd(glyph('fire'), 400, 400)).toEqual([]);
    expect(c.waiting).toBe(true);
    expect(c.update(650)).toEqual([]);
    expect(c.update(701)).toMatchObject([{ kind: 'spell', spell: 'fire' }]);
  });

  it('crosses two glyphs into a combination', () => {
    const c = caster(['fire', 'water', 'steam']);
    c.strokeStart(0);
    c.strokeEnd(glyph('fire'), 400, 400);
    expect(c.strokeStart(600)).toEqual([]);
    const [intent] = c.strokeEnd(glyph('water'), 300, 900);
    expect(intent).toMatchObject({ kind: 'spell', spell: 'steam', drawMs: 700 });
    expect(intent?.strokes).toHaveLength(2);
  });

  it('casts two separate spells when the strokes do not cross', () => {
    const c = caster(['fire', 'water', 'steam']);
    c.strokeStart(0);
    c.strokeEnd(glyph('fire'), 400, 400);
    c.strokeStart(500);
    expect(c.strokeEnd(glyph('water', 300), 300, 800)).toMatchObject([{ kind: 'spell', spell: 'fire' }]);
    expect(c.update(1200)).toMatchObject([{ kind: 'spell', spell: 'water' }]);
  });

  it('does not combine when the second stroke starts after the window', () => {
    const c = caster(['fire', 'water', 'steam']);
    c.strokeStart(0);
    c.strokeEnd(glyph('fire'), 400, 400);
    expect(c.strokeStart(800)).toMatchObject([{ kind: 'spell', spell: 'fire' }]);
  });

  it('fails a crossing of glyphs that make no combination in the set', () => {
    const c = caster(['fire', 'air', 'steam']);
    c.strokeStart(0);
    c.strokeEnd(glyph('fire'), 400, 400);
    c.strokeStart(500);
    expect(c.strokeEnd(glyph('air'), 300, 800)).toMatchObject([{ kind: 'fail', reason: 'noCombo', glyphs: ['fire', 'air'] }]);
  });

  it('reports unrecognised drawings and spells missing from the set', () => {
    const c = caster(['fire']);
    const scribble = [{ x: 0, y: 0 }, { x: 80, y: 3 }, { x: 2, y: 6 }, { x: 79, y: 9 }, { x: 40, y: 90 }, { x: 41, y: 0 }];
    c.strokeStart(0);
    expect(c.strokeEnd(scribble, 300, 300)).toMatchObject([{ kind: 'fail', reason: 'unrecognized' }]);
    c.strokeStart(400);
    expect(c.strokeEnd(glyph('earth'), 300, 700)).toMatchObject([{ kind: 'fail', reason: 'notInSet', glyphs: ['earth'] }]);
  });

  it('rates a combination by its worse stroke', () => {
    expect(worseLevel('precise', 'sloppy')).toBe('sloppy');
    expect(worseLevel('normal', 'precise')).toBe('normal');
  });
});
