import { DEFAULT_TEMPLATES, bounds, pageStrokes, SPELLS, spellById, type Element, type Page, type Point, type SpellKey } from '@grimoire/glyphs';
import { ELEMENT_COLOR } from './theme';

/** Strokes an open polyline with the current line style. */
export function strokePolyline(g: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  if (points.length < 2) return;
  g.beginPath();
  g.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y);
  g.strokePath();
}

/** Reference glyph of an element: the first template variant, in a unit box. */
function referenceGlyph(element: Element): readonly Point[] {
  return DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points;
}

type Frame = { minX: number; minY: number; span: number };

/** Where a point of a stroke lands when its frame is fitted into a `size` box centred on (cx, cy). */
function fitted(p: Point, cx: number, cy: number, size: number, frame: Frame): Point {
  const scale = size / frame.span;
  return { x: Math.round(cx + (p.x - frame.minX - frame.span / 2) * scale), y: Math.round(cy + (p.y - frame.minY - frame.span / 2) * scale) };
}

function strokeFitted(g: Phaser.GameObjects.Graphics, points: readonly Point[], cx: number, cy: number, size: number, frame: Frame): void {
  if (points.length < 2) return;
  g.beginPath();
  points.forEach((p, i) => {
    const { x, y } = fitted(p, cx, cy, size, frame);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.strokePath();
}

function frameOf(strokes: readonly (readonly Point[])[]): Frame {
  const b = bounds(strokes.flat());
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  return { minX: b.minX - (span - (b.maxX - b.minX)) / 2, minY: b.minY - (span - (b.maxY - b.minY)) / 2, span };
}

/**
 * Draws how to write a spell: one glyph, or two crossed glyphs for a combination. From 14 px
 * up, a dot marks where each glyph's one stroke starts.
 */
export function drawSpellGlyph(g: Phaser.GameObjects.Graphics, spell: SpellKey, cx: number, cy: number, size: number, width = 2): void {
  const elements = SPELLS[spell].elements;
  const combo = elements.length > 1;
  elements.forEach((element, i) => {
    const glyph = referenceGlyph(element);
    const frame = frameOf([glyph]);
    // The glyphs share straight lines, so a combination's two sit a little apart to stay readable.
    const shift = combo ? (i === 0 ? -1 : 1) * Math.round(size * 0.08) : 0;
    const box = combo ? size * 0.8 : size;
    g.lineStyle(width, ELEMENT_COLOR[element], 1);
    strokeFitted(g, glyph, cx + shift, cy + shift, box, frame);
    if (size < 14) return;
    const start = fitted(glyph[0]!, cx + shift, cy + shift, box, frame);
    g.fillStyle(ELEMENT_COLOR[element], 1).fillCircle(start.x, start.y, width + 1);
  });
}

/** Draws a stored page: the player's own strokes, coloured by element. */
export function drawPage(g: Phaser.GameObjects.Graphics, page: Page, cx: number, cy: number, size: number, width = 2): void {
  const spell = spellById(page.spellId);
  const strokes = pageStrokes(page);
  const frame = frameOf(strokes);
  strokes.forEach((stroke, i) => {
    const element = spell?.elements[i] ?? spell?.elements[0] ?? 'fire';
    g.lineStyle(width, ELEMENT_COLOR[element], 1);
    strokeFitted(g, stroke, cx, cy, size, frame);
  });
}

/** Small element marker: a coloured shape that differs per element (flame, drop, swirl, pebbles). */
export function drawElementIcon(g: Phaser.GameObjects.Graphics, element: Element, x: number, y: number, r = 4): void {
  g.fillStyle(ELEMENT_COLOR[element], 1);
  switch (element) {
    case 'fire':
      g.fillTriangle(x, y - r - 1, x + r, y + r, x - r, y + r);
      break;
    case 'water':
      g.fillCircle(x, y + 1, r - 0.5);
      g.fillTriangle(x, y - r - 1, x + r - 1, y, x - r + 1, y);
      break;
    case 'air':
      g.lineStyle(2, ELEMENT_COLOR.air, 1).strokeCircle(x, y, r - 1);
      g.fillRect(x, y - 1, r, 2);
      break;
    case 'earth':
      g.fillEllipse(x - r / 3, y + 1, r * 1.5, r * 1.2);
      g.fillCircle(x + r * 0.6, y - r * 0.5, r * 0.45);
      break;
  }
}
