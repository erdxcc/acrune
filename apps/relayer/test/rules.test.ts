import {
  DEFAULT_TEMPLATES,
  quantizeStrokes,
  scribble,
  seededRandom,
  SLOPPINESS,
  SPELLS,
  type Element,
  type Page,
  type SpellKey,
} from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { acceptPages, applyWin, attributesFor, emptyProgress, mergePages } from '../src/grimoire';
import { signToken, verifyToken, type RunClaims } from '../src/tokens';

const SECRET = 'test-secret-test-secret';
const random = seededRandom(9);

function drawing(spell: SpellKey, accuracy = 80): Page {
  const strokes = SPELLS[spell].elements.map((e: Element, i) =>
    scribble(DEFAULT_TEMPLATES.find((t) => t.glyph === e)!.points, random, SLOPPINESS.neat).map((p) => ({ x: p.x + i * 15, y: p.y })),
  );
  return { spellId: SPELLS[spell].id, accuracy, drawMs: 500, ...quantizeStrokes(strokes) };
}

function run(battleId: string, startedAt: number): RunClaims {
  return { v: 1, kind: 'run', userId: 'user-1', titleId: 'ABCD1234', battleId, startedAt };
}

const stats = { durationMs: 60_000, casts: 20, precise: 12, parries: 3 };

describe('tokens', () => {
  it('round-trips and rejects tampering, other kinds and other secrets', () => {
    const claims = run('c1-b1', 1000);
    const token = signToken(claims, SECRET);
    expect(verifyToken(token, 'run', SECRET)).toEqual(claims);
    expect(verifyToken(token, 'progress', SECRET)).toBeNull();
    expect(verifyToken(token, 'run', 'another-secret-12345')).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, battleId: 'c1-boss' })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, 'run', SECRET)).toBeNull();
    expect(verifyToken(`${body}.${sig}.x`, 'run', SECRET)).toBeNull();
    expect(verifyToken(42, 'run', SECRET)).toBeNull();
  });
});

describe('applyWin', () => {
  const start = 1_000_000;
  const empty = emptyProgress('user-1', 'ABCD1234', 0);

  it('counts a plausible first win and adds it up', () => {
    const win = applyWin(empty, run('c1-b1', start), stats, start + 60_000);
    expect(win.counted).toBe(true);
    expect(win.progress).toMatchObject({ cleared: ['c1-b1'], casts: 20, precise: 12, parries: 3, lastRunAt: start });
    expect(win.progress.times['c1-b1']).toBe(60_000);
  });

  it('refuses battles out of order, too fast, replayed or with odd stats', () => {
    expect(applyWin(empty, run('c1-b2', start), stats, start + 60_000)).toMatchObject({ counted: false, reason: expect.stringContaining('order') });
    expect(applyWin(empty, run('c1-b1', start), { ...stats, casts: 4, precise: 2 }, start + 2_000)).toMatchObject({ counted: false, reason: expect.stringContaining('at least') });
    const first = applyWin(empty, run('c1-b1', start), stats, start + 60_000).progress;
    expect(applyWin(first, run('c1-b1', start), stats, start + 120_000)).toMatchObject({ counted: false, reason: expect.stringContaining('already') });
    expect(applyWin(empty, run('c1-b1', start), { ...stats, precise: 30 }, start + 60_000).counted).toBe(false);
    expect(applyWin(empty, run('c1-b1', start), { ...stats, casts: 1000 }, start + 60_000).counted).toBe(false);
    expect(applyWin(empty, run('c1-b1', start), { ...stats, casts: 2.5 }, start + 60_000).counted).toBe(false);
  });

  it('marks the boss and the chapter time after the last battle', () => {
    let progress = empty;
    let t = start;
    for (const id of ['c1-b1', 'c1-b2', 'c1-b3', 'c1-boss']) {
      const win = applyWin(progress, run(id, t), stats, t + 60_000);
      expect(win.counted).toBe(true);
      progress = win.progress;
      t += 100_000;
    }
    expect(progress.bossDefeated).toBe(true);
    expect(progress.bestTimeMs).toBe(240_000);
    const attrs = Object.fromEntries(attributesFor(progress, []).map((a) => [a.key, a.value]));
    expect(attrs).toMatchObject({ 'Chapter 1': 'Cleared', Boss: 'Defeated', 'Best time': '4:00', Accuracy: '60%', Parries: '12' });
  });
});

describe('pages', () => {
  it('keeps only matching drawings of unlocked spells, scored by the relayer', () => {
    const fire = drawing('fire', 99);
    const water = drawing('water');
    const wrong = { ...drawing('water'), spellId: SPELLS.fire.id };
    const locked = drawing('steam');
    const { accepted, rejected } = acceptPages([fire, water, wrong, locked], ['c1-b1']);
    expect(accepted.map((p) => p.spellId)).toEqual([SPELLS.fire.id, SPELLS.water.id]);
    expect(rejected).toBe(1 + 1);
    expect(accepted[0]!.accuracy).toBeLessThanOrEqual(100);
    expect(accepted[0]!.accuracy).not.toBe(99);
  });

  it('merges by keeping the more accurate drawing', () => {
    const a = { ...drawing('fire'), accuracy: 75 };
    const b = { ...drawing('fire'), accuracy: 90 };
    const c = drawing('water');
    expect(mergePages([a, c], [b]).map((p) => p.accuracy)).toEqual([90, c.accuracy]);
    expect(mergePages([b], [a])[0]).toBe(b);
  });
});
