export interface Point {
  x: number;
  y: number;
}

/** One continuous touch, in input coordinates (y grows downwards). */
export type Stroke = readonly Point[];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(stroke: Stroke): number {
  let length = 0;
  for (let i = 1; i < stroke.length; i++) length += distance(stroke[i - 1]!, stroke[i]!);
  return length;
}

export function bounds(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Resamples a stroke into `n` points spaced evenly along its path. */
export function resample(stroke: Stroke, n: number): Point[] {
  const first = stroke[0];
  if (!first || n <= 0) return [];
  const total = pathLength(stroke);
  if (total === 0 || n === 1) return Array.from({ length: n }, () => ({ x: first.x, y: first.y }));

  const interval = total / (n - 1);
  const out: Point[] = [{ x: first.x, y: first.y }];
  let travelled = 0;
  let prev: Point = first;
  for (let i = 1; i < stroke.length && out.length < n; i++) {
    const curr = stroke[i]!;
    let segment = distance(prev, curr);
    while (segment > 0 && travelled + segment >= interval && out.length < n) {
      const t = (interval - travelled) / segment;
      const q = { x: prev.x + t * (curr.x - prev.x), y: prev.y + t * (curr.y - prev.y) };
      out.push(q);
      prev = q;
      segment = distance(prev, curr);
      travelled = 0;
    }
    travelled += segment;
    prev = curr;
  }
  // Floating point drift can leave the final point unplaced.
  const last = stroke[stroke.length - 1]!;
  while (out.length < n) out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Resamples several strokes into `n` points in total, split in proportion to
 * stroke length (at least two points per stroke). Returns the points and the
 * index where each stroke starts.
 */
export function resampleStrokes(strokes: readonly Stroke[], n: number): { points: Point[]; starts: number[] } {
  const usable = strokes.filter((s) => s.length > 0);
  if (usable.length === 0) return { points: [], starts: [] };
  const lengths = usable.map(pathLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  const counts = lengths.map((len) => Math.max(2, Math.round(total > 0 ? (n * len) / total : n / usable.length)));
  // Fix rounding so the counts add up to exactly n, adjusting the longest stroke.
  let diff = n - counts.reduce((a, b) => a + b, 0);
  while (diff !== 0) {
    const longest = counts.indexOf(Math.max(...counts));
    const step = diff > 0 ? 1 : -1;
    if (counts[longest]! + step < 2) break;
    counts[longest]! += step;
    diff -= step;
  }
  const points: Point[] = [];
  const starts: number[] = [];
  usable.forEach((stroke, i) => {
    starts.push(points.length);
    points.push(...resample(stroke, counts[i]!));
  });
  return { points, starts };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Squared distance from `p` to the segment ab. */
function segmentDistance2(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

/**
 * True when the two polylines properly cross each other at least once or, with `touch` above 0,
 * come within `touch` of each other: lines drawn on top of one another count as crossing.
 */
export function strokesCross(a: Stroke, b: Stroke, touch = 0): boolean {
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.maxX + touch < bb.minX || bb.maxX + touch < ba.minX || ba.maxY + touch < bb.minY || bb.maxY + touch < ba.minY) return false;
  const near = touch * touch;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const p1 = a[i - 1]!;
      const p2 = a[i]!;
      const q1 = b[j - 1]!;
      const q2 = b[j]!;
      if (segmentsIntersect(p1, p2, q1, q2)) return true;
      // Segments that do not intersect are closest at an end of one of them.
      if (near > 0 && Math.min(segmentDistance2(p1, q1, q2), segmentDistance2(p2, q1, q2), segmentDistance2(q1, p1, p2), segmentDistance2(q2, p1, p2)) <= near) return true;
    }
  }
  return false;
}
