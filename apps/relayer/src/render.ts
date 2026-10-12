import { bounds, pageStrokes, spellById, type Element, type Page, type Point } from '@grimoire/glyphs';
import { PNG } from 'pngjs';

/**
 * The grimoire's NFT image, drawn as pixel art: a 128×128 parchment page
 * with the owner's own glyph strokes in element colours, scaled ×4.
 */

const SIZE = 128;
const SCALE = 4;

type RGB = [number, number, number];

const ELEMENT: Record<Element, RGB> = {
  fire: [232, 85, 62],
  water: [63, 134, 232],
  air: [108, 195, 90],
  earth: [201, 154, 59],
};
const PARCHMENT: RGB = [233, 220, 184];
const SHADE: RGB = [205, 185, 140];
const LINE: RGB = [138, 115, 80];
const COVER: RGB = [58, 36, 24];
const INK: RGB = [42, 33, 51];
/** The hero's robe. */
const ROBE: RGB = [168, 36, 40];

/** 5×5 letters for the title. */
const LETTERS: Record<string, string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  G: ['01111', '10000', '10011', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '11110', '10010', '10001'],
  U: ['10001', '10001', '10001', '10001', '01110'],
};
const PITCH = 6;

class Canvas {
  readonly px = new Uint8Array(SIZE * SIZE * 3);

  set(x: number, y: number, c: RGB): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return;
    this.px.set(c, (yi * SIZE + xi) * 3);
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  frame(x: number, y: number, w: number, h: number, c: RGB): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  line(a: Point, b: Point, c: RGB): void {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let i = 0; i <= steps; i++) this.set(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, c);
  }

  /** Draws a word and returns the x after it. Unknown characters are blanks. */
  text(x: number, y: number, word: string, c: RGB): number {
    [...word].forEach((ch, k) => {
      const rows = LETTERS[ch];
      if (!rows) return;
      rows.forEach((row, j) => [...row].forEach((bit, i) => bit === '1' && this.set(x + k * PITCH + i, y + j, c)));
    });
    return x + word.length * PITCH;
  }
}

function drawPage(canvas: Canvas, page: Page, x: number, y: number, size: number): void {
  canvas.rect(x, y, size, size, SHADE);
  canvas.frame(x, y, size, size, LINE);
  const spell = spellById(page.spellId);
  const strokes = pageStrokes(page);
  const b = bounds(strokes.flat());
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  const inner = size - 8;
  const fit = (p: Point): Point => ({
    x: x + 4 + ((p.x - b.minX) / span) * inner + (inner - ((b.maxX - b.minX) / span) * inner) / 2,
    y: y + 3 + ((p.y - b.minY) / span) * (inner - 2) + (inner - 2 - ((b.maxY - b.minY) / span) * (inner - 2)) / 2,
  });
  strokes.forEach((stroke, s) => {
    const color = ELEMENT[spell?.elements[s] ?? spell?.elements[0] ?? 'fire'];
    for (let i = 1; i < stroke.length; i++) canvas.line(fit(stroke[i - 1]!), fit(stroke[i]!), color);
  });
  const bar = Math.round(((size - 6) * page.accuracy) / 100);
  canvas.rect(x + 3, y + size - 3, bar, 1, INK);
}

export function renderGrimoire(pages: readonly Page[]): Buffer {
  const canvas = new Canvas();
  canvas.rect(0, 0, SIZE, SIZE, COVER);
  canvas.rect(4, 4, SIZE - 8, SIZE - 8, PARCHMENT);
  canvas.frame(5, 5, SIZE - 10, SIZE - 10, LINE);
  const title = 'ACRUNE GRIMOIRE';
  const after = canvas.text(Math.round((SIZE - (title.length * PITCH - 1)) / 2), 9, 'ACRUNE ', ROBE);
  canvas.text(after, 9, 'GRIMOIRE', INK);
  canvas.rect(12, 18, SIZE - 24, 1, LINE);
  // Three rows of three fit between the title (y 22) and the inner border (y 123).
  const cell = 31;
  const gap = 3;
  const left = Math.round((SIZE - (cell * 3 + gap * 2)) / 2);
  pages.slice(0, 9).forEach((page, i) => drawPage(canvas, page, left + (i % 3) * (cell + gap), 22 + Math.floor(i / 3) * (cell + gap), cell));

  const png = new PNG({ width: SIZE * SCALE, height: SIZE * SCALE });
  for (let y = 0; y < SIZE * SCALE; y++) {
    for (let x = 0; x < SIZE * SCALE; x++) {
      const src = (Math.floor(y / SCALE) * SIZE + Math.floor(x / SCALE)) * 3;
      const dst = (y * SIZE * SCALE + x) * 4;
      png.data[dst] = canvas.px[src]!;
      png.data[dst + 1] = canvas.px[src + 1]!;
      png.data[dst + 2] = canvas.px[src + 2]!;
      png.data[dst + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
