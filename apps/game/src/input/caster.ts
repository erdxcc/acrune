import {
  bounds,
  isCombo,
  spellOfElements,
  SPELLS,
  strokesCross,
  type AccuracyLevel,
  type Element,
  type Point,
  type Recognition,
  type Recognizer,
  type SpellKey,
} from '@grimoire/glyphs';

/**
 * Turns finished strokes into casts:
 * - one stroke is an element;
 * - a second stroke that starts within the combo window after the first one
 *   lifts and crosses it makes a combination, as accurate as the worse stroke
 *   (the glyphs share straight lines, so lines drawn over each other count);
 * - when no combination with that element is in the set, the element fires on lift;
 * - strokes that do not cross are two separate casts.
 */

export type CastIntent =
  | { kind: 'spell'; spell: SpellKey; level: AccuracyLevel; score: number; strokes: Point[][]; drawMs: number }
  | { kind: 'fail'; reason: 'unrecognized' | 'notInSet' | 'noCombo'; glyphs: (Element | null)[]; strokes: Point[][] };

interface FinishedStroke {
  points: Point[];
  recognition: Recognition<Element>;
  drawMs: number;
  liftedAt: number;
}

const RANK: Record<AccuracyLevel, number> = { failed: 0, sloppy: 1, normal: 2, precise: 3 };

/** How close the second stroke must come to the first to cross it, as a share of the larger glyph. */
const TOUCH = 0.05;

function extent(points: readonly Point[]): number {
  const b = bounds(points);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

export function worseLevel(a: AccuracyLevel, b: AccuracyLevel): AccuracyLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export class GlyphCaster {
  private pending: FinishedStroke | null = null;
  private drawing = false;

  constructor(
    private readonly recognizer: Recognizer<Element>,
    private readonly set: readonly SpellKey[],
    private readonly comboWindowMs: number,
  ) {}

  /** True while a first stroke waits for a possible second one. */
  get waiting(): boolean {
    return this.pending !== null;
  }

  /** The element of the waiting first stroke, if any. */
  get waitingGlyph(): Element | null {
    return this.pending?.recognition.glyph ?? null;
  }

  /** Combinations in the set that the waiting stroke can still become, with the glyph that completes each. */
  combosFor(element: Element): { spell: SpellKey; with: Element }[] {
    return this.set
      .filter((key) => isCombo(key) && SPELLS[key].elements.includes(element))
      .map((spell) => ({ spell, with: SPELLS[spell].elements.find((e) => e !== element) ?? element }));
  }

  strokeStart(now: number): CastIntent[] {
    const out = this.flush(now);
    this.drawing = true;
    return out;
  }

  strokeEnd(points: Point[], drawMs: number, now: number): CastIntent[] {
    this.drawing = false;
    const stroke: FinishedStroke = { points, recognition: this.recognizer.recognize(points), drawMs, liftedAt: now };
    const out: CastIntent[] = [];
    const first = this.pending;
    if (first) {
      this.pending = null;
      const touch = TOUCH * Math.max(extent(first.points), extent(points));
      if (strokesCross(first.points, points, touch)) return [this.combine(first, stroke)];
      out.push(this.single(first));
    }
    const glyph = stroke.recognition.glyph;
    if (stroke.recognition.level !== 'failed' && glyph && this.combosWith(glyph)) {
      this.pending = stroke;
      return out;
    }
    out.push(this.single(stroke));
    return out;
  }

  /** Call every frame: releases a waiting stroke once the combo window has passed. */
  update(now: number): CastIntent[] {
    return this.drawing ? [] : this.flush(now);
  }

  private flush(now: number): CastIntent[] {
    if (!this.pending || now - this.pending.liftedAt <= this.comboWindowMs) return [];
    const stroke = this.pending;
    this.pending = null;
    return [this.single(stroke)];
  }

  private combosWith(element: Element): boolean {
    return this.set.some((key) => isCombo(key) && SPELLS[key].elements.includes(element));
  }

  private single(stroke: FinishedStroke): CastIntent {
    const { glyph, level, score } = stroke.recognition;
    const strokes = [stroke.points];
    if (level === 'failed' || !glyph) return { kind: 'fail', reason: 'unrecognized', glyphs: [glyph], strokes };
    if (!this.set.includes(glyph)) return { kind: 'fail', reason: 'notInSet', glyphs: [glyph], strokes };
    return { kind: 'spell', spell: glyph, level, score, strokes, drawMs: stroke.drawMs };
  }

  private combine(first: FinishedStroke, second: FinishedStroke): CastIntent {
    const a = first.recognition;
    const b = second.recognition;
    const strokes = [first.points, second.points];
    const glyphs = [a.glyph, b.glyph];
    if (a.level === 'failed' || b.level === 'failed' || !a.glyph || !b.glyph) {
      return { kind: 'fail', reason: 'unrecognized', glyphs, strokes };
    }
    const combo = spellOfElements([a.glyph, b.glyph]);
    if (!combo || !isCombo(combo) || !this.set.includes(combo)) return { kind: 'fail', reason: 'noCombo', glyphs, strokes };
    return {
      kind: 'spell',
      spell: combo,
      level: worseLevel(a.level, b.level),
      score: Math.min(a.score, b.score),
      strokes,
      drawMs: first.drawMs + second.drawMs,
    };
  }
}
