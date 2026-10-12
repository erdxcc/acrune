import { bounds, resampleStrokes, type Point, type Stroke } from './geometry';

/**
 * Binary page block stored in the grimoire's AppData plugin (format 1):
 *
 *   "GR" | version u8 | page count u8 | page × N
 *   page = spell id u8 | accuracy u8 | draw ms u16 LE | second stroke index u8
 *          | reserved u8 | 24 × (x u8, y u8)
 */

export const PAGES_FORMAT = 1;
export const PAGE_POINTS = 24;
export const PAGE_BYTES = 6 + PAGE_POINTS * 2;
export const PAGES_MAX_BYTES = 700;
const HEADER_BYTES = 4;
const MAGIC_G = 0x47;
const MAGIC_R = 0x52;

export interface Page {
  spellId: number;
  /** 0-100. */
  accuracy: number;
  /** Time spent drawing, ms. */
  drawMs: number;
  /** Index of the first point of the second stroke; 0 when there is one stroke. */
  secondStroke: number;
  /** PAGE_POINTS points on a 0-255 grid, proportions kept. */
  points: Point[];
}

function toByte(value: number, max = 255): number {
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Fits up to two strokes into the page grid: 24 points, centred, proportions kept. */
export function quantizeStrokes(strokes: readonly Stroke[]): { points: Point[]; secondStroke: number } {
  const { points, starts } = resampleStrokes(strokes.slice(0, 2), PAGE_POINTS);
  if (points.length === 0) throw new Error('cannot quantize an empty drawing');
  const b = bounds(points);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const scale = 255 / (Math.max(w, h) || 1);
  const offsetX = (255 - w * scale) / 2;
  const offsetY = (255 - h * scale) / 2;
  return {
    points: points.map((p) => ({ x: toByte((p.x - b.minX) * scale + offsetX), y: toByte((p.y - b.minY) * scale + offsetY) })),
    secondStroke: starts[1] ?? 0,
  };
}

/** Splits a page back into its strokes. */
export function pageStrokes(page: Pick<Page, 'points' | 'secondStroke'>): Point[][] {
  const split = page.secondStroke;
  if (split <= 0 || split >= page.points.length) return [page.points];
  return [page.points.slice(0, split), page.points.slice(split)];
}

export function encodePages(pages: readonly Page[]): Uint8Array {
  if (pages.length > 255) throw new Error('too many pages');
  const bytes = new Uint8Array(HEADER_BYTES + pages.length * PAGE_BYTES);
  if (bytes.length > PAGES_MAX_BYTES) throw new Error(`page block is ${bytes.length} bytes, limit ${PAGES_MAX_BYTES}`);
  bytes.set([MAGIC_G, MAGIC_R, PAGES_FORMAT, pages.length]);
  pages.forEach((page, index) => {
    if (page.points.length !== PAGE_POINTS) throw new Error(`page ${index} has ${page.points.length} points`);
    const o = HEADER_BYTES + index * PAGE_BYTES;
    const ms = toByte(page.drawMs, 0xffff);
    bytes[o] = toByte(page.spellId);
    bytes[o + 1] = toByte(page.accuracy, 100);
    bytes[o + 2] = ms & 0xff;
    bytes[o + 3] = ms >> 8;
    bytes[o + 4] = toByte(page.secondStroke);
    bytes[o + 5] = 0;
    page.points.forEach((p, i) => {
      bytes[o + 6 + i * 2] = toByte(p.x);
      bytes[o + 7 + i * 2] = toByte(p.y);
    });
  });
  return bytes;
}

export function decodePages(bytes: Uint8Array): Page[] {
  if (bytes.length < HEADER_BYTES || bytes[0] !== MAGIC_G || bytes[1] !== MAGIC_R) {
    throw new Error('not a grimoire page block');
  }
  if (bytes[2] !== PAGES_FORMAT) throw new Error(`unsupported page format ${bytes[2]}`);
  const count = bytes[3]!;
  if (bytes.length < HEADER_BYTES + count * PAGE_BYTES) throw new Error('page block is truncated');
  return Array.from({ length: count }, (_, index) => {
    const o = HEADER_BYTES + index * PAGE_BYTES;
    return {
      spellId: bytes[o]!,
      accuracy: bytes[o + 1]!,
      drawMs: bytes[o + 2]! | (bytes[o + 3]! << 8),
      secondStroke: bytes[o + 4]!,
      points: Array.from({ length: PAGE_POINTS }, (_, i) => ({ x: bytes[o + 6 + i * 2]!, y: bytes[o + 7 + i * 2]! })),
    };
  });
}
