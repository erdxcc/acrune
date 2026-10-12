import { SPELL_KEYS, SPELLS, type Element, type SpellKey } from '@grimoire/glyphs';
import { css, ELEMENT_COLOR, PALETTE } from '../ui/theme';
import manifest from './manifest.json';

/**
 * Sprite sets from manifest.json. The artist's strips load from
 * public/assets (tools/art/convert.py writes them); anything missing is painted
 * here as a coloured placeholder with the same key, frame size and frame count,
 * so art drops in by file.
 */

export interface AnimSpec {
  frames: number;
  fps: number;
  loop?: boolean;
  file?: string;
  /** Frame order when it is not 0..frames-1, e.g. a ping-pong loop. */
  sequence?: number[];
}

export interface SpriteSpec {
  frame: [number, number];
  /** Feet point as a fraction of the frame. */
  anchor: [number, number];
  /** How far the sprite reaches in front of its anchor, in px (the hero's staff). */
  reach?: number;
  /** Display scale; the placeholders are drawn smaller than the artist's frames. */
  scale?: number;
  /** Colour multiplied over the set, e.g. "#c8a2ff" for a variant of another set. */
  tint?: string;
  anims: Record<string, AnimSpec>;
}

export function spriteScale(set: string): number {
  return SPRITES[set]?.scale ?? 1;
}

export function spriteTint(set: string): number | null {
  const tint = SPRITES[set]?.tint;
  return tint ? parseInt(tint.slice(1), 16) : null;
}

/** The artist's flight for a spell: a set with `fly` (looping) and `hit` animations. Without one the painted shot flies. */
export function spellFx(spell: SpellKey): string {
  return `fx_${spell}`;
}

export const SPRITES = manifest.sprites as unknown as Record<string, SpriteSpec>;
/** Single images by texture key, e.g. backgrounds. */
const IMAGES = ((manifest as { images?: Record<string, string> }).images ?? {}) as Record<string, string>;

export function animKey(set: string, anim: string): string {
  return `${set}_${anim}`;
}

export function projectileKey(spell: SpellKey): string {
  return `proj_${spell}`;
}

export function queueSpriteFiles(load: Phaser.Loader.LoaderPlugin): void {
  for (const [set, spec] of Object.entries(SPRITES)) {
    for (const [anim, a] of Object.entries(spec.anims)) {
      if (a.file) load.spritesheet(animKey(set, anim), `assets/${a.file}`, { frameWidth: spec.frame[0], frameHeight: spec.frame[1] });
    }
  }
  for (const [key, file] of Object.entries(IMAGES)) load.image(key, `assets/${file}`);
}

export function buildSprites(scene: Phaser.Scene): void {
  for (const [set, spec] of Object.entries(SPRITES)) {
    for (const [anim, a] of Object.entries(spec.anims)) {
      const key = animKey(set, anim);
      if (!scene.textures.exists(key)) paintStrip(scene, key, set, anim, spec, a.frames);
      if (!scene.anims.exists(key)) {
        scene.anims.create({
          key,
          frames: (a.sequence ?? Array.from({ length: a.frames }, (_, i) => i)).map((frame) => ({ key, frame })),
          frameRate: a.fps,
          repeat: a.loop ? -1 : 0,
        });
      }
    }
  }
  for (const spell of SPELL_KEYS) if (!scene.textures.exists(projectileKey(spell))) paintSingle(scene, projectileKey(spell), 16, 16, (pen) => projectile(pen, spell));
  if (!scene.textures.exists('bg_chapter1')) paintSingle(scene, 'bg_chapter1', 800, 360, background);
  if (!scene.textures.exists('tutorial_hand')) paintSingle(scene, 'tutorial_hand', 16, 16, hand);
}

// ---------------------------------------------------------------- painting

class Pen {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  alpha = 1;

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.globalAlpha = alpha * this.alpha;
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  disc(cx: number, cy: number, r: number, color: number, alpha = 1): void {
    const rr = Math.round(r);
    for (let dy = -rr; dy <= rr; dy++) {
      const dx = Math.floor(Math.sqrt(rr * rr - dy * dy));
      this.rect(cx - dx, cy + dy, dx * 2 + 1, 1, color, alpha);
    }
  }

  ring(cx: number, cy: number, r: number, color: number, alpha = 1): void {
    const steps = Math.max(12, Math.round(r * 8));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      this.rect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1, 1, color, alpha);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, thickness = 2): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      this.rect(x - thickness / 2, y - thickness / 2, thickness, thickness, color);
    }
  }

  /** Scanline fill of a convex polygon, without anti-aliasing. */
  poly(points: readonly [number, number][], color: number, alpha = 1): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const scan = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[(i + 1) % points.length]!;
        if ((ay <= scan && by > scan) || (by <= scan && ay > scan)) xs.push(ax + ((scan - ay) / (by - ay)) * (bx - ax));
      }
      if (xs.length < 2) continue;
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      this.rect(left, y, right - left, 1, color, alpha);
    }
  }
}

function shade(color: number, amount: number): number {
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * amount)));
  return (f((color >> 16) & 255) << 16) | (f((color >> 8) & 255) << 8) | f(color & 255);
}

function paintSingle(scene: Phaser.Scene, key: string, w: number, h: number, draw: (pen: Pen, w: number, h: number) => void): void {
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) return;
  draw(new Pen(texture.getContext()), w, h);
  texture.refresh();
}

function paintStrip(scene: Phaser.Scene, key: string, set: string, anim: string, spec: SpriteSpec, frames: number): void {
  const [w, h] = spec.frame;
  const texture = scene.textures.createCanvas(key, w * frames, h);
  if (!texture) return;
  const ctx = texture.getContext();
  for (let i = 0; i < frames; i++) {
    ctx.save();
    ctx.translate(i * w, 0);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const t = frames > 1 ? i / (frames - 1) : 0;
    const pen = new Pen(ctx);
    const element = set.split('_')[1] as Element | undefined;
    if (set === 'hero') hero(pen, anim, t, i);
    else if (set.startsWith('monster_')) monster(pen, anim, t, i, element ?? 'fire');
    else if (set.startsWith('mage_')) mage(pen, anim, t, i, element ?? 'fire');
    else boss(pen, anim, t, i);
    ctx.restore();
    texture.add(i, 0, i * w, 0, w, h);
  }
  texture.refresh();
}

const SKIN = 0xe2b893;
const WOOD = 0x7a5230;

function hero(pen: Pen, anim: string, t: number, i: number): void {
  const loop = anim === 'idle' || anim === 'draw';
  const bob = loop ? (i % 2) : 0;
  const ox = anim === 'hurt' ? Math.round(-3 * (1 - t)) : 0;
  const oy = anim === 'defeat' ? Math.round(t * 20) : bob;
  if (anim === 'defeat') pen.alpha = 1 - t * 0.5;
  pen.rect(18, 61, 28, 2, 0x000000, 0.3);
  const robe = 0x5b3f8f;
  pen.poly([[24 + ox, 32 + oy], [40 + ox, 32 + oy], [45 + ox, 62], [19 + ox, 62]], robe);
  pen.rect(19 + ox, 57, 26, 5, shade(robe, 0.7));
  pen.rect(24 + ox, 42 + oy, 16, 2, PALETTE.gold);
  pen.disc(32 + ox, 24 + oy, 7, SKIN);
  pen.poly([[23 + ox, 24 + oy], [32 + ox, 12 + oy], [41 + ox, 24 + oy], [38 + ox, 20 + oy], [26 + ox, 20 + oy]], shade(robe, 0.8));
  pen.rect(34 + ox, 24 + oy, 2, 2, PALETTE.ink);
  pen.rect(37 + ox, 24 + oy, 2, 2, PALETTE.ink);
  const gem = 0x9fe8ff;
  switch (anim) {
    case 'cast': {
      const tipX = 44 + Math.round(16 * t);
      const tipY = 12 + Math.round(14 * t);
      pen.line(40 + ox, 60, tipX, tipY, WOOD);
      pen.disc(tipX, tipY, 3, gem);
      if (t > 0.5) pen.disc(tipX, tipY, 6, 0xffffff, 0.35);
      break;
    }
    case 'parry':
      pen.line(30 + ox, 42 + oy, 60, 24 + oy, WOOD);
      pen.disc(60, 23 + oy, 3, gem);
      pen.ring(60, 23 + oy, 6 + Math.round(t * 3), 0xffffff, 0.8);
      break;
    default: {
      const lift = anim === 'draw' ? 4 : 0;
      pen.line(44 + ox, 12 + oy - lift, 44 + ox, 62, WOOD);
      pen.disc(44 + ox, 10 + oy - lift, 3, gem);
      if (anim === 'draw') pen.disc(44 + ox, 10 + oy - lift, 6, gem, 0.3);
    }
  }
  if (anim === 'fail') {
    const r = 3 + Math.round(t * 8);
    pen.disc(40, 38, r, 0xff8a3c, 0.7);
    pen.disc(40, 38, Math.max(1, r - 3), 0xffe08a, 0.8);
  }
  if (anim === 'hurt' && t < 0.7) pen.rect(18 + ox, 14, 30, 48, PALETTE.hp, 0.35);
}

function monster(pen: Pen, anim: string, t: number, i: number, element: Element): void {
  const color = ELEMENT_COLOR[element];
  const squash = anim === 'walk' ? i % 2 : 0;
  const lunge = anim === 'attack' ? -Math.round(Math.sin(t * Math.PI) * 6) : 0;
  const shrink = anim === 'death' ? t : 0;
  if (anim === 'death') pen.alpha = 1 - t;
  pen.rect(10, 46, 28, 2, 0x000000, 0.3);
  const top = 22 + squash + Math.round(shrink * 18);
  const height = 46 - top;
  pen.rect(10 + lunge, top, 28, height, color);
  pen.rect(10 + lunge, 40, 28, 6, shade(color, 0.65));
  pen.rect(12 + lunge, top - 2, 24, 2, color);
  // Element crest so the type reads by shape as well as colour.
  switch (element) {
    case 'fire':
      pen.poly([[13 + lunge, top], [17 + lunge, top - 8], [21 + lunge, top]], shade(color, 1.2));
      pen.poly([[22 + lunge, top], [27 + lunge, top - 10], [32 + lunge, top]], shade(color, 1.2));
      break;
    case 'water':
      pen.disc(24 + lunge, top - 4, 4, shade(color, 1.25));
      pen.poly([[21 + lunge, top - 5], [24 + lunge, top - 12], [27 + lunge, top - 5]], shade(color, 1.25));
      break;
    case 'air':
      pen.ring(24 + lunge, top - 6, 5, shade(color, 1.3));
      pen.ring(24 + lunge, top - 6, 2, shade(color, 1.3));
      break;
    case 'earth':
      pen.rect(14 + lunge, top - 5, 6, 5, shade(color, 0.8));
      pen.rect(26 + lunge, top - 7, 7, 7, shade(color, 0.8));
      break;
  }
  if (anim !== 'death' || t < 0.6) {
    pen.rect(14 + lunge, top + 6, 5, 5, 0xffffff);
    pen.rect(14 + lunge, top + 8, 2, 2, PALETTE.ink);
    pen.rect(22 + lunge, top + 6, 5, 5, 0xffffff);
    pen.rect(22 + lunge, top + 8, 2, 2, PALETTE.ink);
  }
  if (anim === 'attack' && t > 0.2 && t < 0.8) pen.rect(12 + lunge, top + 15, 10, 3, PALETTE.ink);
  const step = anim === 'walk' ? (i % 2 ? 1 : -1) : 0;
  pen.rect(14 + lunge, 46 + Math.min(0, step), 5, 2, shade(color, 0.5));
  pen.rect(29 + lunge, 46 + Math.min(0, -step), 5, 2, shade(color, 0.5));
  if (anim === 'hurt') pen.rect(10, top, 28, height, 0xffffff, 0.55);
}

function mage(pen: Pen, anim: string, t: number, i: number, element: Element): void {
  const color = ELEMENT_COLOR[element];
  const bob = anim === 'walk' || anim === 'cast' ? i % 2 : 0;
  const ox = anim === 'hurt' ? Math.round(3 * (1 - t)) : 0;
  const oy = anim === 'death' ? Math.round(t * 22) : bob;
  if (anim === 'death') pen.alpha = 1 - t * 0.8;
  pen.rect(18, 61, 28, 2, 0x000000, 0.3);
  const robe = shade(color, 0.6);
  pen.poly([[25 + ox, 30 + oy], [39 + ox, 30 + oy], [45 + ox, 62], [19 + ox, 62]], robe);
  pen.rect(19 + ox, 57, 26, 5, shade(color, 0.4));
  pen.rect(24 + ox, 44 + oy, 16, 2, color);
  pen.disc(32 + ox, 22 + oy, 8, shade(color, 0.45));
  pen.rect(25 + ox, 19 + oy, 9, 8, SKIN);
  pen.rect(26 + ox, 22 + oy, 2, 2, 0xffffff);
  pen.rect(30 + ox, 22 + oy, 2, 2, 0xffffff);
  const gem = shade(color, 1.35);
  switch (anim) {
    case 'cast':
      pen.line(16 + ox, 6 + oy, 22 + ox, 54, WOOD);
      pen.disc(16 + ox, 4 + oy, 3, gem);
      pen.disc(16 + ox, 4 + oy, 6, gem, 0.3);
      break;
    case 'release': {
      const tipX = 16 - Math.round(14 * t);
      const tipY = 6 + Math.round(24 * t);
      pen.line(22 + ox, 54, tipX, tipY, WOOD);
      pen.disc(tipX, tipY, 3, gem);
      break;
    }
    case 'parry':
      pen.line(4, 32 + oy, 30, 28 + oy, WOOD);
      pen.disc(4, 32 + oy, 3, gem);
      pen.ring(4, 32 + oy, 6 + Math.round(t * 3), 0xffffff, 0.8);
      break;
    default:
      pen.line(18 + ox, 14 + oy, 18 + ox, 62, WOOD);
      pen.disc(18 + ox, 12 + oy, 3, gem);
  }
  if (anim === 'hurt' && t < 0.7) pen.rect(16 + ox, 12, 32, 50, PALETTE.hp, 0.35);
}

function boss(pen: Pen, anim: string, t: number, i: number): void {
  const stone = 0x3b3346;
  const glow = 0xff5a3c;
  const bob = anim === 'walk' || anim === 'cast' ? i % 2 : 0;
  const oy = anim === 'death' ? Math.round(t * 40) : bob;
  if (anim === 'death') pen.alpha = 1 - t * 0.9;
  pen.rect(26, 124, 76, 4, 0x000000, 0.3);
  pen.poly([[40, 44 + oy], [88, 44 + oy], [102, 126], [26, 126]], stone);
  pen.rect(26, 116, 76, 10, shade(stone, 0.7));
  pen.line(40, 44 + oy, 32, 124, PALETTE.gold, 2);
  pen.line(88, 44 + oy, 96, 124, PALETTE.gold, 2);
  pen.rect(48, 16 + oy, 32, 30, shade(stone, 0.8));
  pen.poly([[48, 18 + oy], [38, 0 + oy], [54, 14 + oy]], shade(stone, 1.3));
  pen.poly([[80, 18 + oy], [90, 0 + oy], [74, 14 + oy]], shade(stone, 1.3));
  pen.rect(53, 28 + oy, 7, 4, glow);
  pen.rect(68, 28 + oy, 7, 4, glow);
  switch (anim) {
    case 'cast':
      pen.rect(30, 30 + oy, 12, 26, shade(stone, 1.1));
      pen.rect(86, 30 + oy, 12, 26, shade(stone, 1.1));
      pen.disc(64, 8 + oy, 7, glow, 0.6);
      break;
    case 'release':
      pen.rect(8 + Math.round(10 * (1 - t)), 56, 34, 12, shade(stone, 1.1));
      pen.disc(8, 62, 5 + Math.round(t * 4), glow, 0.7);
      break;
    default:
      pen.rect(30, 52 + oy, 12, 34, shade(stone, 1.1));
      pen.rect(86, 52 + oy, 12, 34, shade(stone, 1.1));
  }
  if (anim === 'phase') pen.rect(20, 0, 88, 128, 0xffffff, Math.sin(t * Math.PI) * 0.7);
  if (anim === 'hurt') pen.rect(26, 16, 76, 110, PALETTE.hp, 0.3);
}

function projectile(pen: Pen, spell: SpellKey): void {
  const [a, b] = SPELLS[spell].elements.map((e) => ELEMENT_COLOR[e]);
  switch (spell) {
    case 'fire':
      pen.poly([[1, 8], [9, 3], [15, 8], [9, 13]], a!);
      pen.disc(10, 8, 2, 0xffe08a);
      break;
    case 'water':
      pen.disc(10, 8, 4, a!);
      pen.poly([[1, 8], [8, 4], [8, 12]], a!);
      pen.rect(11, 6, 2, 2, 0xffffff);
      break;
    case 'air':
      pen.ring(9, 8, 5, a!);
      pen.ring(9, 8, 2, a!);
      pen.rect(1, 7, 4, 2, a!);
      break;
    case 'earth':
      pen.rect(4, 4, 9, 9, a!);
      pen.rect(4, 11, 9, 2, shade(a!, 0.6));
      pen.rect(10, 4, 3, 3, shade(a!, 1.3));
      break;
    case 'steam':
      pen.disc(6, 9, 4, 0xdfe7ee);
      pen.disc(11, 7, 4, 0xf4f7fa);
      pen.rect(5, 8, 2, 2, a!);
      pen.rect(11, 8, 2, 2, b!);
      break;
    case 'ice':
      pen.poly([[2, 8], [9, 2], [15, 8], [9, 14]], 0x9fe8ff);
      pen.rect(8, 5, 2, 4, 0xffffff);
      break;
    case 'magma':
      pen.disc(9, 8, 5, 0x5a2a1a);
      pen.line(6, 6, 11, 10, 0xff8a3c, 1);
      pen.line(11, 5, 8, 11, 0xffc04a, 1);
      break;
  }
}

function background(pen: Pen, w: number, h: number): void {
  const top = [0x2a1f3d, 0x3a2550, 0x4f2d5c, 0x6b3f55, 0x8a5257];
  const band = Math.ceil(260 / top.length);
  top.forEach((c, i) => pen.rect(0, i * band, w, band, c));
  for (let i = 0; i < 40; i++) pen.rect((i * 97) % w, (i * 53) % 150, 1, 1, 0xf3ead2, 0.6);
  pen.disc(620, 70, 16, 0xf0d8a8, 0.9);
  const far: [number, number][] = [[0, 260], [0, 200]];
  for (let x = 0; x <= w; x += 50) far.push([x, 190 + ((x * 37) % 50)]);
  far.push([w, 200], [w, 260]);
  for (let i = 0; i < far.length - 2; i += 1) {
    const [x0, y0] = far[i + 1]!;
    const [x1, y1] = far[i + 2]!;
    pen.poly([[x0, 260], [x0, y0], [x1, y1], [x1, 260]], 0x3b2a48);
  }
  for (let x = 0; x < w; x += 70) pen.poly([[x - 10, 300], [x + 25, 240 + ((x * 13) % 30)], [x + 60, 300]], 0x2d2238);
  pen.rect(0, 300, w, h - 300, 0x3a2c25);
  pen.rect(0, 298, w, 4, 0x4f6b3a);
  for (let i = 0; i < 160; i++) pen.rect((i * 61) % w, 304 + ((i * 29) % (h - 306)), 2, 1, 0x2b201b);
}

function hand(pen: Pen): void {
  const glove = 0xf3ead2;
  pen.rect(5, 1, 3, 8, glove);
  pen.rect(3, 7, 9, 7, glove);
  pen.rect(8, 5, 2, 3, glove);
  pen.rect(10, 6, 2, 3, glove);
  pen.rect(3, 13, 9, 2, PALETTE.dim);
}
