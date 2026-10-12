import { bounds, distance, resample, type Point } from './geometry';

/**
 * Synthetic "hand-drawn" copies of templates, used by tests and the glyph lab
 * to spot confusable glyphs before real samples exist. Not a substitute for
 * samples from people.
 */

/** mulberry32: small deterministic PRNG returning [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sloppiness {
  /** Max rotation, radians. */
  rotate: number;
  /** Max independent change of width and height, as a fraction. */
  stretch: number;
  /** Max horizontal shear. */
  shear: number;
  /** Smooth wobble amplitude, as a fraction of glyph size. */
  wobble: number;
  /** Per-point jitter, as a fraction of glyph size. */
  jitter: number;
  /** Max share of the path left out or overdrawn at the end. */
  trim: number;
}

export const SLOPPINESS = {
  neat: { rotate: 0.08, stretch: 0.1, shear: 0.08, wobble: 0.02, jitter: 0.004, trim: 0.03 },
  casual: { rotate: 0.18, stretch: 0.2, shear: 0.15, wobble: 0.045, jitter: 0.008, trim: 0.08 },
  messy: { rotate: 0.3, stretch: 0.3, shear: 0.25, wobble: 0.08, jitter: 0.015, trim: 0.15 },
} satisfies Record<string, Sloppiness>;

/**
 * Imitates a hand-drawn copy of `template`, `size` units across: random
 * direction and start point, a gap or overshoot at the end, smooth wobble,
 * rotation, stretch, shear and jitter.
 */
export function scribble(template: readonly Point[], random: () => number, s: Sloppiness, size = 120): Point[] {
  const span = (v: number) => (random() * 2 - 1) * v;
  let pts = resample(template, 160);
  const tb = bounds(pts);
  const extent = Math.max(tb.maxX - tb.minX, tb.maxY - tb.minY) || 1;

  const closed = distance(pts[0]!, pts[pts.length - 1]!) < 0.05 * extent;
  if (closed) {
    const ring = pts.slice(0, -1);
    const k = Math.floor(random() * ring.length);
    pts = [...ring.slice(k), ...ring.slice(0, k)];
    pts.push({ ...pts[0]! });
  }
  if (random() < 0.5) pts.reverse();

  const cut = Math.round(span(s.trim) * pts.length);
  if (cut > 0) pts = pts.slice(0, pts.length - cut);
  else if (cut < 0 && closed) pts = [...pts, ...pts.slice(1, 1 - cut)];

  const waves = Array.from({ length: 3 }, () => ({
    fx: 0.5 + random() * 2,
    fy: 0.5 + random() * 2,
    px: random() * 2 * Math.PI,
    py: random() * 2 * Math.PI,
  }));
  const last = pts.length - 1 || 1;
  pts = pts.map((p, i) => {
    const t = i / last;
    let dx = 0;
    let dy = 0;
    for (const w of waves) {
      dx += Math.sin(2 * Math.PI * w.fx * t + w.px);
      dy += Math.sin(2 * Math.PI * w.fy * t + w.py);
    }
    return { x: p.x + (dx / waves.length) * s.wobble * extent, y: p.y + (dy / waves.length) * s.wobble * extent };
  });

  const cx = (tb.minX + tb.maxX) / 2;
  const cy = (tb.minY + tb.maxY) / 2;
  const angle = span(s.rotate);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = 1 + span(s.stretch);
  const sy = 1 + span(s.stretch);
  const shear = span(s.shear);
  return pts.map((p) => {
    const x0 = (p.x - cx) / extent;
    const y0 = (p.y - cy) / extent;
    const x1 = x0 * sx + y0 * shear;
    const y1 = y0 * sy;
    return {
      x: size / 2 + (x1 * cos - y1 * sin) * size + span(s.jitter) * size,
      y: size / 2 + (x1 * sin + y1 * cos) * size + span(s.jitter) * size,
    };
  });
}
