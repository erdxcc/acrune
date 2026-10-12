import type { Point } from '@grimoire/glyphs';

/**
 * Captures drawing strokes with native pointer events on the game canvas
 * (coalesced events for smooth lines on phones). Only touches that start
 * inside `accepts` count, and a second finger is ignored while one draws.
 * Points are in game coordinates.
 */

export interface StrokeHandlers {
  start(point: Point, now: number): void;
  move(point: Point): void;
  end(points: Point[], durationMs: number, now: number): void;
}

export class StrokeInput {
  private pointerId: number | null = null;
  private points: Point[] = [];
  private startedAt = 0;
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gameSize: () => { width: number; height: number },
    private readonly accepts: (p: Point) => boolean,
    private readonly handlers: StrokeHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  get drawing(): boolean {
    return this.pointerId !== null;
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  private toGame(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const { width, height } = this.gameSize();
    return { x: ((clientX - rect.left) / rect.width) * width, y: ((clientY - rect.top) / rect.height) * height };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null) return;
    const p = this.toGame(e.clientX, e.clientY);
    if (!this.accepts(p)) return;
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; window listeners still see the stroke.
    }
    this.points = [p];
    this.startedAt = performance.now();
    this.handlers.start(p, this.startedAt);
    e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length > 0 ? events : [e]) {
      const p = this.toGame(ev.clientX, ev.clientY);
      const last = this.points[this.points.length - 1]!;
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 0.75) continue;
      this.points.push(p);
      this.handlers.move(p);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const now = performance.now();
    this.handlers.end(this.points, now - this.startedAt, now);
    this.points = [];
  };
}
