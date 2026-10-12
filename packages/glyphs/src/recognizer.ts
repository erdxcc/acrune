import { bounds, pathLength, resample, type Point, type Stroke } from './geometry';

/**
 * Point-cloud glyph recognizer after $Q (Vatavu, Anthony, Wobbrock, 2018).
 *
 * Strokes become clouds of `cloudSize` points (resampled, scaled uniformly,
 * centred), so drawing order and direction do not matter. Rotation is not
 * normalised: a glyph's orientation is part of its identity.
 */

export type AccuracyLevel = 'precise' | 'normal' | 'sloppy' | 'failed';

export interface Thresholds {
  precise: number;
  normal: number;
  sloppy: number;
  /** When the best two glyphs score closer than this, the level drops by one. */
  gap: number;
}

export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = { precise: 85, normal: 70, sloppy: 55, gap: 8 };

export interface GlyphTemplate<G extends string = string> {
  glyph: G;
  /** Variant label, e.g. "cw" for a clockwise spiral. */
  variant?: string;
  points: Stroke;
}

export interface RecognizerOptions {
  /** Points per cloud; $Q uses 32. */
  cloudSize?: number;
  /** Matched-point RMS distance, as a fraction of glyph size, that scores 0. */
  zeroScoreRms?: number;
  thresholds?: Partial<Thresholds>;
  /** Strokes shorter than this, in input units, are rejected. */
  minPathLength?: number;
}

export const DEFAULT_CLOUD_SIZE = 32;
export const DEFAULT_ZERO_SCORE_RMS = 0.3;

export interface GlyphScore<G extends string> {
  glyph: G;
  score: number;
}

export interface Recognition<G extends string> {
  /** Best matching glyph, also when the level is 'failed'. Null if nothing was compared. */
  glyph: G | null;
  /** 0-100. */
  score: number;
  level: AccuracyLevel;
  /** Best score per glyph, highest first. */
  ranking: GlyphScore<G>[];
}

const LEVELS: readonly AccuracyLevel[] = ['failed', 'sloppy', 'normal', 'precise'];

export function levelOf(score: number, runnerUp: number, t: Thresholds): AccuracyLevel {
  let rank = score >= t.precise ? 3 : score >= t.normal ? 2 : score >= t.sloppy ? 1 : 0;
  if (rank > 0 && score - runnerUp < t.gap) rank--;
  return LEVELS[rank]!;
}

/** Resample, scale into a unit box (keeping proportions) and move the centroid to the origin. */
export function normalizeCloud(stroke: Stroke, n: number): Point[] {
  const points = resample(stroke, n);
  const b = bounds(points);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map((p) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size }));
}

/**
 * Weighted sum of squared distances when greedily matching every point of `a`
 * to its nearest unmatched point of `b`, starting at `start`. Stops early once
 * the sum reaches `minSoFar`.
 */
function cloudDistance(a: readonly Point[], b: readonly Point[], start: number, minSoFar: number): number {
  const n = a.length;
  const matched = new Uint8Array(n);
  let sum = 0;
  let weight = n;
  let i = start;
  do {
    const p = a[i]!;
    let nearest = -1;
    let nearestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const q = b[j]!;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = dx * dx + dy * dy;
      if (d < nearestD) {
        nearestD = d;
        nearest = j;
      }
    }
    matched[nearest] = 1;
    sum += weight * nearestD;
    if (sum >= minSoFar) return sum;
    weight--;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function greedyCloudMatch(a: readonly Point[], b: readonly Point[], minSoFar: number): number {
  const n = a.length;
  const step = Math.floor(Math.sqrt(n));
  let min = minSoFar;
  for (let i = 0; i < n; i += step) {
    min = Math.min(min, cloudDistance(a, b, i, min));
    min = Math.min(min, cloudDistance(b, a, i, min));
  }
  return min;
}

export class Recognizer<G extends string> {
  readonly cloudSize: number;
  readonly zeroScoreRms: number;
  readonly thresholds: Thresholds;
  readonly minPathLength: number;
  private readonly clouds: { glyph: G; cloud: Point[] }[] = [];

  constructor(templates: readonly GlyphTemplate<G>[], options: RecognizerOptions = {}) {
    this.cloudSize = options.cloudSize ?? DEFAULT_CLOUD_SIZE;
    this.zeroScoreRms = options.zeroScoreRms ?? DEFAULT_ZERO_SCORE_RMS;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.minPathLength = options.minPathLength ?? 0;
    for (const template of templates) this.addTemplate(template);
  }

  addTemplate(template: GlyphTemplate<G>): void {
    if (template.points.length < 2) return;
    this.clouds.push({ glyph: template.glyph, cloud: normalizeCloud(template.points, this.cloudSize) });
  }

  get glyphs(): G[] {
    return [...new Set(this.clouds.map((c) => c.glyph))];
  }

  /** Scores one stroke against the templates, optionally only those of `only`. */
  recognize(stroke: Stroke, only?: readonly G[]): Recognition<G> {
    const failed: Recognition<G> = { glyph: null, score: 0, level: 'failed', ranking: [] };
    if (stroke.length < 2 || pathLength(stroke) < this.minPathLength) return failed;

    const cloud = normalizeCloud(stroke, this.cloudSize);
    const best = new Map<G, number>();
    for (const { glyph, cloud: template } of this.clouds) {
      if (only && !only.includes(glyph)) continue;
      const prev = best.get(glyph) ?? Infinity;
      const d = greedyCloudMatch(cloud, template, prev);
      if (d < prev) best.set(glyph, d);
    }

    const ranking = [...best]
      .map(([glyph, d]) => ({ glyph, score: this.scoreOf(d) }))
      .sort((a, b) => b.score - a.score);
    const top = ranking[0];
    if (!top) return failed;
    const runnerUp = ranking[1]?.score ?? 0;
    return { glyph: top.glyph, score: top.score, level: levelOf(top.score, runnerUp, this.thresholds), ranking };
  }

  private scoreOf(weightedSum: number): number {
    const n = this.cloudSize;
    const rms = Math.sqrt(weightedSum / ((n * (n + 1)) / 2));
    return 100 * Math.max(0, 1 - rms / this.zeroScoreRms);
  }
}
