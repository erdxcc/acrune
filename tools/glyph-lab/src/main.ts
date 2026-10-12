import {
  DEFAULT_TEMPLATES,
  ELEMENTS,
  Recognizer,
  scribble,
  seededRandom,
  SLOPPINESS,
  type Element,
  type GlyphTemplate,
  type Point,
  type Recognition,
} from '@grimoire/glyphs';

/**
 * Glyph lab: draw candidate glyphs, record labelled samples from several
 * people and devices, and read the confusion matrix and score spread under
 * the current templates and thresholds.
 */

interface Sample {
  glyph: Element;
  person: string;
  device: string;
  points: Point[];
  at: string;
}

interface StoredTemplate {
  glyph: Element;
  variant: string;
  points: Point[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = $<HTMLCanvasElement>('pad');
const ctx = pad.getContext('2d')!;

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the data stays in memory for this tab.
  }
}

let samples = load<Sample>('glyphlab.samples');
let custom = load<StoredTemplate>('glyphlab.templates');

function num(id: string, fallback: number): number {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function templates(): GlyphTemplate<Element>[] {
  return [
    ...($<HTMLInputElement>('use-defaults').checked ? DEFAULT_TEMPLATES : []),
    ...custom.map((t) => ({ glyph: t.glyph, variant: t.variant, points: t.points })),
  ];
}

function recognizer(): Recognizer<Element> {
  return new Recognizer(templates(), {
    zeroScoreRms: num('t-rms', 0.3),
    thresholds: { precise: num('t-precise', 85), normal: num('t-normal', 70), sloppy: num('t-sloppy', 55), gap: num('t-gap', 8) },
    minPathLength: 40,
  });
}

// ------------------------------------------------------------ drawing pad

function drawPad(stroke: Point[] = [], color = '#2a2133'): void {
  const s = pad.width;
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = '#8a7350';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  if (stroke.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
  for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

let stroke: Point[] = [];
let pointer: number | null = null;
let device = 'mouse';

function toPad(e: PointerEvent): Point {
  const rect = pad.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) / rect.width) * pad.width, y: ((e.clientY - rect.top) / rect.height) * pad.height };
}

pad.addEventListener('pointerdown', (e) => {
  if (pointer !== null) return;
  pointer = e.pointerId;
  device = e.pointerType || 'mouse';
  pad.setPointerCapture(e.pointerId);
  stroke = [toPad(e)];
  drawPad(stroke);
});
pad.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointer) return;
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) stroke.push(toPad(ev));
  drawPad(stroke);
});
const finish = (e: PointerEvent) => {
  if (e.pointerId !== pointer) return;
  pointer = null;
  onStroke(stroke);
};
pad.addEventListener('pointerup', finish);
pad.addEventListener('pointercancel', finish);

function describe(r: Recognition<Element>): string {
  return r.glyph ? `${r.glyph} · ${r.score.toFixed(1)} · ${r.level}` : 'nothing recognised';
}

function onStroke(points: Point[]): void {
  const mode = $<HTMLSelectElement>('mode').value;
  const glyph = $<HTMLSelectElement>('glyph').value as Element;
  const result = recognizer().recognize(points);
  const ok = result.level !== 'failed';
  drawPad(points, ok ? '#2c6e26' : '#a82424');
  $('ranking').textContent = result.ranking.map((g) => `${g.glyph} ${g.score.toFixed(0)}`).join(' · ');
  if (mode === 'template') {
    custom.push({ glyph, variant: `custom-${custom.length + 1}`, points });
    save('glyphlab.templates', custom);
    $('result').textContent = `Saved as a ${glyph} template.`;
  } else if (mode === 'sample') {
    samples.push({ glyph, person: $<HTMLInputElement>('person').value || 'anon', device, points, at: new Date().toISOString() });
    save('glyphlab.samples', samples);
    const right = result.glyph === glyph && ok;
    $('result').innerHTML = `<span class="${right ? 'good' : 'bad'}">${describe(result)}</span> <span class="dim">(sample ${samples.length})</span>`;
  } else {
    $('result').textContent = describe(result);
  }
  refresh();
}

// ------------------------------------------------------------ reports

function matrix(entries: { glyph: Element; points: Point[] }[]): string {
  const r = recognizer();
  const columns: (Element | 'failed')[] = [...ELEMENTS, 'failed'];
  const counts = new Map<string, number>();
  const scores = new Map<Element, number[]>();
  let correct = 0;
  let wrong = 0;
  let failed = 0;
  for (const s of entries) {
    const res = r.recognize(s.points);
    const col = res.level === 'failed' ? 'failed' : res.glyph!;
    counts.set(`${s.glyph}:${col}`, (counts.get(`${s.glyph}:${col}`) ?? 0) + 1);
    if (col === 'failed') failed++;
    else if (col === s.glyph) {
      correct++;
      scores.set(s.glyph, [...(scores.get(s.glyph) ?? []), res.score]);
    } else wrong++;
  }
  const total = entries.length || 1;
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(0) : '-');
  const head = `<tr><th>drawn \\ read</th>${columns.map((c) => `<th>${c}</th>`).join('')}<th>median score</th></tr>`;
  const rows = ELEMENTS.map(
    (g) => `<tr><th>${g}</th>${columns.map((c) => `<td>${counts.get(`${g}:${c}`) ?? ''}</td>`).join('')}<td>${median(scores.get(g) ?? [])}</td></tr>`,
  ).join('');
  const pct = (n: number) => `${((100 * n) / total).toFixed(1)}%`;
  return `<p>${entries.length} drawings: <span class="good">correct ${pct(correct)}</span>, <span class="bad">misread ${pct(wrong)}</span>, failed ${pct(failed)}. Goals: ≥ 95% correct on neat drawings, &lt; 2% misread.</p><table>${head}${rows}</table>`;
}

function refresh(): void {
  const people = new Set(samples.map((s) => s.person));
  const devices = new Set(samples.map((s) => s.device));
  $('summary').textContent = `${samples.length} samples from ${people.size} people on ${[...devices].join(', ') || 'no devices yet'}.`;
  $('matrix').innerHTML = samples.length ? matrix(samples) : '';
  $('template-count').textContent = `${custom.length} of my templates`;
}

$('synthetic').addEventListener('click', () => {
  const random = seededRandom(7);
  const out: string[] = [];
  for (const [level, sloppiness] of Object.entries(SLOPPINESS)) {
    const entries = templates().flatMap((t) => Array.from({ length: 60 }, () => ({ glyph: t.glyph, points: scribble(t.points, random, sloppiness) })));
    out.push(`<h2>Synthetic, ${level}</h2>${matrix(entries)}`);
  }
  $('synthetic-out').innerHTML = out.join('');
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ samples, templates: custom }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `glyph-lab-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$<HTMLInputElement>('import').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { samples?: Sample[]; templates?: StoredTemplate[] };
    samples = [...samples, ...(data.samples ?? [])];
    custom = [...custom, ...(data.templates ?? [])];
    save('glyphlab.samples', samples);
    save('glyphlab.templates', custom);
    refresh();
  } catch (err) {
    alert(`Could not import: ${err}`);
  }
});

$('undo').addEventListener('click', () => {
  samples.pop();
  save('glyphlab.samples', samples);
  refresh();
});

$('clear-templates').addEventListener('click', () => {
  if (!confirm('Delete all templates drawn here?')) return;
  custom = [];
  save('glyphlab.templates', custom);
  refresh();
});

for (const id of ['t-precise', 't-normal', 't-sloppy', 't-gap', 't-rms', 'use-defaults']) $(id).addEventListener('change', refresh);

drawPad();
refresh();
