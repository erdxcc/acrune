/**
 * Synthetic confusion report for candidate glyph sets.
 * Run: pnpm --filter @grimoire/glyphs evaluate
 */
import {
  DEFAULT_GLYPH_SET,
  ELEMENTS,
  PREVIOUS_GLYPH_SET,
  quantizeStrokes,
  Recognizer,
  SLOPPINESS,
  scribble,
  seededRandom,
  templatesFor,
  type CandidateName,
  type Element,
} from '../src';

const SAMPLES = 400;

const SETS: Record<string, Record<Element, readonly CandidateName[]>> = {
  default: DEFAULT_GLYPH_SET,
  previous: PREVIOUS_GLYPH_SET,
};

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
}

for (const [name, set] of Object.entries(SETS)) {
  const recognizer = new Recognizer(templatesFor(set));
  console.log(`\n=== ${name} ===`);
  for (const [level, sloppiness] of Object.entries(SLOPPINESS)) {
    const random = seededRandom(1234);
    const rows: string[] = [];
    let wrong = 0;
    let total = 0;
    const scores: number[] = [];
    const pageScores: number[] = [];
    const margins: number[] = [];
    const levels: Record<string, number> = { precise: 0, normal: 0, sloppy: 0, failed: 0 };
    for (const element of ELEMENTS) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < SAMPLES; i++) {
        const variant = set[element][i % set[element].length]!;
        const stroke = scribble(templatesFor({ ...set, [element]: [variant] }).find((t) => t.glyph === element)!.points, random, sloppiness);
        const r = recognizer.recognize(stroke);
        counts[r.glyph ?? '-'] = (counts[r.glyph ?? '-'] ?? 0) + 1;
        total++;
        if (r.glyph !== element) wrong++;
        else {
          scores.push(r.score);
          margins.push(r.score - (r.ranking[1]?.score ?? 0));
          const page = quantizeStrokes([stroke]);
          pageScores.push(recognizer.recognize(page.points).score);
        }
        levels[r.glyph === element ? r.level : 'failed']!++;
      }
      rows.push(`  ${element.padEnd(6)} ${ELEMENTS.map((e) => String(counts[e] ?? 0).padStart(5)).join('')}`);
    }
    scores.sort((a, b) => a - b);
    pageScores.sort((a, b) => a - b);
    margins.sort((a, b) => a - b);
    const fmt = (xs: number[]) => [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => percentile(xs, p).toFixed(0).padStart(4)).join('');
    console.log(`-- ${level}: wrong ${((100 * wrong) / total).toFixed(2)}%`);
    console.log(`  ${''.padEnd(6)} ${ELEMENTS.map((e) => e.padStart(5)).join('')}`);
    console.log(rows.join('\n'));
    console.log(`  score   p5..p95 ${fmt(scores)}`);
    console.log(`  page    p5..p95 ${fmt(pageScores)}`);
    console.log(`  margin  p5..p95 ${fmt(margins)}`);
    console.log(`  levels  ${Object.entries(levels).map(([k, v]) => `${k} ${((100 * v) / total).toFixed(1)}%`).join(', ')}`);
  }
}
