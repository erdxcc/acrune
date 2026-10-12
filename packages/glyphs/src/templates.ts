import type { Point } from './geometry';
import type { GlyphTemplate } from './recognizer';
import type { Element } from './spells';

/**
 * Candidate glyph shapes in a unit box, y pointing down. The glyph lab picks
 * the final set; DEFAULT_TEMPLATES is the starting proposal.
 */

const STEP = 0.02;

/** Densifies a polyline so all templates have a similar point density. */
function polyline(corners: readonly [number, number][], closed = false): Point[] {
  const path = closed ? [...corners, corners[0]!] : corners;
  const out: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    for (let s = 0; s < steps; s++) out.push({ x: x0 + ((x1 - x0) * s) / steps, y: y0 + ((y1 - y0) * s) / steps });
  }
  const [lx, ly] = path[path.length - 1]!;
  out.push({ x: lx, y: ly });
  return out;
}

function curve(samples: number, fn: (t: number) => [number, number]): Point[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const [x, y] = fn(i / samples);
    return { x, y };
  });
}

/** Horizontal sine wave; `up` starts by rising. */
function wave(periods: number, amplitude: number, up: boolean): Point[] {
  const sign = up ? -1 : 1;
  return curve(120, (t) => [t, 0.5 + sign * amplitude * Math.sin(2 * Math.PI * periods * t)]);
}

/** Spiral from the centre outwards. Clockwise on screen (y down) when `cw`. */
function spiral(turns: number, cw: boolean): Point[] {
  const sign = cw ? 1 : -1;
  return curve(160, (t) => {
    const angle = t * turns * 2 * Math.PI;
    const r = 0.5 * t;
    return [0.5 + r * Math.cos(angle), 0.5 + sign * r * Math.sin(angle)];
  });
}

const H = Math.sqrt(3) / 2;

export const GLYPH_CANDIDATES = {
  triangle: polyline([[0.5, 0], [1, H], [0, H]], true),
  triangleDown: polyline([[0, 0], [1, 0], [0.5, H]], true),
  waveUp: wave(1.5, 0.25, true),
  waveDown: wave(1.5, 0.25, false),
  spiralCw: spiral(1.75, true),
  spiralCcw: spiral(1.75, false),
  square: polyline([[0, 0], [1, 0], [1, 1], [0, 1]], true),
  mountain: polyline([[0, 1], [0.25, 0], [0.5, 0.6], [0.75, 0], [1, 1]]),
  zigzag: polyline([[0, 0], [1, 0], [0, 1], [1, 1]]),
  lightning: polyline([[0.6, 0], [0.2, 0.55], [0.8, 0.45], [0.4, 1]]),
  // The artist's glyphs (symbols.jpeg), each drawn in one stroke of straight lines.
  /** A bar to the left at the top, down, a bar to the right at the bottom. */
  step: polyline([[0.15, 0], [0.5, 0], [0.5, 1], [0.85, 1]]),
  /** ⊥ in one stroke: down the stem, then along the base, back over one half of it. */
  tack: polyline([[0.5, 0], [0.5, 1], [0, 1], [1, 1]]),
  tackRight: polyline([[0.5, 0], [0.5, 1], [1, 1], [0, 1]]),
  /** ⊥ from one end of the base: up the stem and back down it. */
  tackStem: polyline([[0, 1], [0.5, 1], [0.5, 0], [0.5, 1], [1, 1]]),
  zed: polyline([[0, 0.1], [1, 0.1], [0, 0.9], [1, 0.9]]),
  /** Up to the top, down the stem, a foot to the right: a 1 standing on its base. */
  flag: polyline([[0, 0.65], [0.7, 0], [0.7, 0.78], [1, 0.78]]),
} satisfies Record<string, Point[]>;

export type CandidateName = keyof typeof GLYPH_CANDIDATES;

/**
 * Element glyphs: the artist's straight-line symbols, simpler to draw than the first proposal
 * (fire △, water ∿, air spiral, earth M; `previous` in `pnpm evaluate`). Fire is a step, water
 * ⊥, air Z, earth a 1 on its base. Water lists the usual ways to draw ⊥ in one stroke: with one
 * template, 7% of casual synthetic ⊥ drawn another way were read as fire; with all three, none.
 * The first variant is the reference the game shows and the tutorial traces.
 */
export const DEFAULT_GLYPH_SET: Readonly<Record<Element, readonly CandidateName[]>> = {
  fire: ['step'],
  water: ['tack', 'tackRight', 'tackStem'],
  air: ['zed'],
  earth: ['flag'],
};

/** The glyphs before the artist's symbols, kept for comparison. */
export const PREVIOUS_GLYPH_SET: Readonly<Record<Element, readonly CandidateName[]>> = {
  fire: ['triangle'],
  water: ['waveUp', 'waveDown'],
  air: ['spiralCw', 'spiralCcw'],
  earth: ['mountain'],
};

export function templatesFor(set: Readonly<Record<Element, readonly CandidateName[]>>): GlyphTemplate<Element>[] {
  return (Object.keys(set) as Element[]).flatMap((glyph) =>
    set[glyph].map((variant) => ({ glyph, variant, points: GLYPH_CANDIDATES[variant] })),
  );
}

export const DEFAULT_TEMPLATES: readonly GlyphTemplate<Element>[] = templatesFor(DEFAULT_GLYPH_SET);
