import { describe, expect, it } from 'vitest';
import { strokesCross, type Point } from '../src';

const line = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

describe('strokesCross', () => {
  it('finds a proper crossing', () => {
    expect(strokesCross(line(0, 0, 10, 10), line(0, 10, 10, 0))).toBe(true);
  });

  it('keeps apart strokes apart', () => {
    expect(strokesCross(line(0, 0, 10, 0), line(0, 5, 10, 5))).toBe(false);
    expect(strokesCross(line(0, 0, 10, 0), line(0, 5, 10, 5), 4)).toBe(false);
  });

  it('counts lines drawn over each other only with a touch distance', () => {
    expect(strokesCross(line(0, 0, 10, 0), line(5, 0, 15, 0))).toBe(false);
    expect(strokesCross(line(0, 0, 10, 0), line(5, 0, 15, 0), 0.5)).toBe(true);
    expect(strokesCross(line(0, 0, 10, 0), line(0, 3, 10, 3), 4)).toBe(true);
  });
});
