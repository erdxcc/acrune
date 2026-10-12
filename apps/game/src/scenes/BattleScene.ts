import {
  counterSpell,
  DEFAULT_TEMPLATES,
  isCombo,
  knownSpells,
  Recognizer,
  resample,
  SPELLS,
  type AccuracyLevel,
  type Element,
  type Point,
  type SpellKey,
} from '@grimoire/glyphs';
import Phaser from 'phaser';
import { app } from '../app';
import { animKey, projectileKey, spellFx, SPRITES, spriteScale, spriteTint } from '../assets/sprites';
import { sfx } from '../audio/sfx';
import { BestDrawings } from '../battle/pages';
import { BattleSim, STEP_SECONDS, type CastResult, type Enemy, type SimEvent } from '../battle/sim';
import { BALANCE, battleDef, enemyDef, SPELL_DEFS } from '../content';
import { GlyphCaster, type CastIntent } from '../input/caster';
import { StrokeInput } from '../input/strokes';
import { finishRun, startRun } from '../state/runs';
import { drawElementIcon, drawSpellGlyph, strokePolyline } from '../ui/glyphs';
import { openSettings } from '../ui/settingsPanel';
import { css, ELEMENT_COLOR, PALETTE, spellColors } from '../ui/theme';
import { Button, label, panel } from '../ui/widgets';
import { cover, fadeIn, go } from './common';

const GROUND = 300;
/** Lowest screen y for cast sparks, so they stay under the boss's health bar. */
const SPARKS_TOP = 56;
/** In the artist's grimoire (grimoire.png): the row where its two pages meet, and the column of its cover edge there. */
const BOOK_CREASE = 35;
const BOOK_EDGE = 29;
/** Painted shots are 16 px; this keeps them readable next to the characters. */
const SHOT_SCALE = 2;

/** Darker tones that read on parchment. */
const PAGE_INK = { text: 0x2a2133, gold: 0x8a5c08, bad: 0xa82424, good: 0x2c6e26, warn: 0xa8520e };

const LEVEL_TEXT: Record<AccuracyLevel, [string, number]> = {
  precise: ['PRECISE!', PAGE_INK.gold],
  normal: ['GOOD', PAGE_INK.text],
  sloppy: ['UNSTABLE', PAGE_INK.warn],
  failed: ['FAILED', PAGE_INK.bad],
};

interface Layout {
  W: number;
  H: number;
  gx: number;
  gw: number;
  fx0: number;
  fx1: number;
  heroX: number;
  /** Screen x of field position 0: the tip of the hero's staff. */
  fieldX0: number;
  spineY: number;
  circle: { x: number; y: number; r: number };
  topPage: { x: number; y: number; w: number; h: number };
}

/**
 * The grimoire takes ~34% of the width on the chosen side (the drawing circle keeps its
 * 92 px radius from 640 px up); the field is the rest. The hero stands at the field's edge.
 */
function layoutFor(W: number, H: number, side: 'left' | 'right'): Layout {
  const gw = Math.round(W * 0.34);
  const gx = side === 'right' ? W - gw : 0;
  const fx0 = side === 'right' ? 0 : gw;
  const r = Math.min(Math.floor(gw / 2) - 16, 92);
  const circle = { x: gx + Math.round(gw / 2), y: H - r - 12, r };
  const spineY = circle.y - r - 22;
  const hero = SPRITES.hero;
  const heroScale = spriteScale('hero');
  // From the hero's back edge to its feet, so the robe stays on screen.
  const heroBack = hero ? Math.ceil(hero.anchor[0] * hero.frame[0] * heroScale) + 2 : 44;
  return {
    W,
    H,
    gx,
    gw,
    fx0,
    fx1: fx0 + W - gw,
    heroX: fx0 + heroBack,
    fieldX0: fx0 + heroBack + (SPRITES.hero?.reach ?? 0) * heroScale,
    spineY,
    circle,
    topPage: { x: gx + 14, y: 14, w: gw - 28, h: spineY - 34 },
  };
}

interface EnemyView {
  sprite: Phaser.GameObjects.Sprite;
  set: string;
  /** Screen y of its feet. */
  ground: number;
  /** Coming out from the far edge of the field: 0 at the edge, 1 at its post. */
  enter: number;
  /** Screen distance from the edge to its post. */
  enterFrom: number;
}

interface Shot {
  sprite: Phaser.GameObjects.Sprite;
  startX: number;
  startY: number;
}

type Lesson = 'draw' | 'parry' | 'combo';

/** A lesson holds the battle until the cast it teaches. */
interface Tutorial {
  lesson: Lesson;
  objects: { destroy(): void }[];
  tween: Phaser.Tweens.Tween;
  done: (spell: SpellKey, result: CastResult) => boolean;
}

export class BattleScene extends Phaser.Scene {
  private battleId = '';
  private set: SpellKey[] = [];
  private L!: Layout;
  private sim!: BattleSim;
  private caster!: GlyphCaster;
  private strokes!: StrokeInput;
  private best!: BestDrawings;
  private hero!: Phaser.GameObjects.Sprite;
  private heroDown = false;
  private enemies = new Map<number, EnemyView>();
  private shots = new Map<number, Shot>();
  private fx!: Phaser.GameObjects.Graphics;
  private ink!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Graphics;
  private hintGlyph!: Phaser.GameObjects.Graphics;
  private spellRows: { spell: SpellKey; objects: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] }[] = [];
  private feedback!: Phaser.GameObjects.Text;
  private parryHint!: Phaser.GameObjects.Text;
  private hintSpell: SpellKey | null = null;
  private bossName: Phaser.GameObjects.Text | null = null;
  private waveLabel!: Phaser.GameObjects.Text;
  private current: Point[] = [];
  private waiting: Point[][] = [];
  private ringState: 'idle' | 'active' | 'success' | 'fail' = 'idle';
  private ringUntil = 0;
  private accumulator = 0;
  private paused = false;
  private ended = false;
  private tutorial: Tutorial | null = null;
  /** The tutorial is about to start: the battle waits for it. */
  private tutorialPending = false;
  /** After the first lesson, the first enemy cast teaches the parry. */
  private parryLessonDue = false;
  private comboHint!: Phaser.GameObjects.Container;
  private comboHintFor: Element | null = null;
  private startedAt = 0;
  private runToken: Promise<string | null> = Promise.resolve(null);
  private pauseButton!: Button;

  constructor() {
    super('battle');
  }

  init(data: { battleId: string; set: SpellKey[] }): void {
    this.battleId = data.battleId;
    this.set = data.set;
  }

  create(): void {
    fadeIn(this);
    const { profile, recognizer } = app();
    this.L = layoutFor(this.scale.width, this.scale.height, profile.settings.grimoireSide);
    this.enemies = new Map();
    this.shots = new Map();
    this.spellRows = [];
    this.heroDown = false;
    this.ended = false;
    this.paused = false;
    this.accumulator = 0;
    this.current = [];
    this.waiting = [];
    this.hintSpell = null;
    this.bossName = null;
    this.ringState = 'idle';
    this.tutorial = null;
    this.tutorialPending = false;
    this.parryLessonDue = false;
    this.comboHintFor = null;

    // Bottom-aligned, so the hero and the enemies stand on the road. The box starts left of the
    // field (under the grimoire or off-screen) so the signpost does not stand behind the hero.
    const battle = battleDef(this.battleId);
    const background = this.textures.exists(battle.background) ? battle.background : 'bg_chapter1';
    cover(this, background, this.L.fx0 - 90, 0, this.L.fx1 - this.L.fx0 + 90, this.L.H, 1).setDepth(0);
    this.drawGrimoire();
    const [ox, oy] = SPRITES.hero?.anchor ?? [0.5, 1];
    this.hero = this.add.sprite(this.L.heroX, GROUND, animKey('hero', 'idle')).setOrigin(ox, oy).setScale(spriteScale('hero')).setDepth(12);
    this.hero.play(animKey('hero', 'idle'));
    this.fx = this.add.graphics().setDepth(25);

    this.sim = new BattleSim(battle, { balance: BALANCE, spells: SPELL_DEFS, enemy: enemyDef }, Date.now() & 0x7fffffff);
    this.waveLabel = label(this, this.L.fx0 + 44, 18, '', 8, PALETTE.text, [0, 0.5]).setDepth(80).setStroke('#141019', 3);
    // One step brings the first enemy out, even while the tutorial holds the battle.
    this.sim.step();
    const strict = new Recognizer(DEFAULT_TEMPLATES, { minPathLength: this.L.circle.r * 0.35 });
    this.caster = new GlyphCaster(strict, this.set, BALANCE.comboWindowMs);
    this.best = new BestDrawings(recognizer, profile.pages);
    this.strokes = new StrokeInput(
      this.game.canvas,
      () => ({ width: this.L.W, height: this.L.H }),
      (p) => this.insideCircle(p),
      {
        start: (p, now) => this.onStrokeStart(p, now),
        move: (p) => this.current.push(p),
        end: (points, ms, now) => this.onStrokeEnd(points, ms, now),
      },
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.strokes.destroy());

    this.pauseButton = new Button(this, this.L.fx0 + 22, 18, 'II', () => this.pause(), { width: 28, height: 22, tone: 'quiet' });
    this.pauseButton.bg.setDepth(80);
    this.pauseButton.text.setDepth(81);
    this.startedAt = Date.now();
    this.runToken = startRun(this.battleId);
    this.banner(this.sim.battle.name.toUpperCase());
    // After the name has faded, so the two banners never overlap.
    const firstCombo = this.set.find((s) => isCombo(s));
    const lesson: (() => void) | null =
      this.battleId === 'c1-b1' && !profile.settings.tutorialDone
        ? () => this.drawLesson()
        : this.battleId === 'c1-b3' && firstCombo && !profile.settings.comboTutorialDone
          ? () => this.comboLesson(firstCombo)
          : null;
    if (lesson) {
      this.tutorialPending = true;
      this.time.delayedCall(1400, () => {
        this.tutorialPending = false;
        lesson();
      });
    }
  }

  override update(_time: number, delta: number): void {
    for (const intent of this.caster.update(performance.now())) this.onIntent(intent);
    if (!this.paused && !this.ended && !this.tutorial && !this.tutorialPending) {
      this.accumulator += Math.min(delta, 100) / 1000;
      while (this.accumulator >= STEP_SECONDS) {
        this.sim.step();
        this.accumulator -= STEP_SECONDS;
      }
    }
    for (const event of this.sim.drainEvents()) this.onEvent(event);
    this.syncEnemies();
    this.syncShots();
    this.drawOverlay();
    this.drawInk();
    this.drawRing();
    this.updateSpellRows();
    this.updateParryHint();
    this.updateComboHint();
  }

  // ------------------------------------------------------------ grimoire

  private drawGrimoire(): void {
    const { gx, gw, H, circle, spineY } = this.L;
    const g = this.add.graphics().setDepth(50);
    if (this.textures.exists('grimoire')) this.drawBook();
    else {
      g.fillStyle(0x3a2418, 1).fillRect(gx, 0, gw, H);
      g.fillStyle(PALETTE.parchment, 1).fillRect(gx + 6, 6, gw - 12, H - 12);
      g.lineStyle(2, PALETTE.parchmentLine, 1).strokeRect(gx + 7, 7, gw - 14, H - 14);
      g.fillStyle(PALETTE.parchmentShade, 1).fillRect(gx + 6, spineY - 2, gw - 12, 4);
    }
    g.lineStyle(2, PALETTE.parchmentLine, 1).strokeCircle(circle.x, circle.y, circle.r);
    g.lineStyle(1, PALETTE.parchmentLine, 0.6).strokeCircle(circle.x, circle.y, circle.r - 8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineBetween(circle.x + Math.cos(a) * (circle.r - 8), circle.y + Math.sin(a) * (circle.r - 8), circle.x + Math.cos(a) * circle.r, circle.y + Math.sin(a) * circle.r);
    }
    this.drawSpellList();
    this.ring = this.add.graphics().setDepth(51);
    this.ink = this.add.graphics().setDepth(52);
    this.hintGlyph = this.add.graphics().setDepth(53);
    this.feedback = label(this, circle.x, spineY + 7, '', 8, PAGE_INK.text, [0.5, 0]).setDepth(55);
    this.comboHint = this.add.container(0, 0).setDepth(56);
    this.parryHint = label(this, this.L.topPage.x, spineY - 16, '', 8, PAGE_INK.bad).setDepth(55);
  }

  /**
   * The artist's open grimoire, turned on its side: the crease between its pages lies on the
   * spine between the spell list and the circle, and its cover edge curves out over the field.
   * Where the painting ends on a wide screen, its paper colour goes on.
   */
  private drawBook(): void {
    const { gx, gw, H, spineY } = this.L;
    const size = this.textures.get('grimoire').getSourceImage().height;
    const k = Math.max(spineY / BOOK_CREASE, (H - spineY) / (size - BOOK_CREASE));
    const onRight = gx > 0;
    const paper = this.textures.getPixel(size - 1, size - 1, 'grimoire')?.color ?? PALETTE.parchment;
    this.add.rectangle(gx, 0, gw, H, paper).setOrigin(0, 0).setDepth(49);
    this.add
      .image(onRight ? gx - BOOK_EDGE * k : gx + gw - (size - BOOK_EDGE) * k, spineY - BOOK_CREASE * k, 'grimoire')
      .setOrigin(0, 0)
      .setScale(k)
      .setFlipX(!onRight)
      .setDepth(49.5);
  }

  private drawSpellList(): void {
    const { x, y, w, h } = this.L.topPage;
    const columns = 2;
    const rows = Math.max(1, Math.ceil(this.set.length / columns));
    const rowH = Math.min(28, Math.floor(h / rows));
    this.set.forEach((spell, i) => {
      const cx = x + (i % columns) * Math.floor(w / columns);
      const cy = y + Math.floor(i / columns) * rowH;
      const g = this.add.graphics().setDepth(53);
      drawSpellGlyph(g, spell, cx + 10, cy + rowH / 2, Math.min(18, rowH - 8), 2);
      const name = label(this, cx + 24, cy + rowH / 2 - 9, SPELL_DEFS[spell].name.toUpperCase(), 8, PAGE_INK.text).setDepth(53);
      // A combination shows its recipe: the two glyphs to cross, then its mana.
      const recipe = isCombo(spell) ? SPELLS[spell].elements : [];
      recipe.forEach((element, k) => drawSpellGlyph(g, element, cx + 28 + k * 12, cy + rowH / 2 + 5, 9, 1));
      const mana = label(this, cx + 24 + recipe.length * 12, cy + rowH / 2 + 1, `${SPELL_DEFS[spell].mana}${recipe.length ? '' : ' mana'}`, 8, 0x2f5f9e).setDepth(53);
      this.spellRows.push({ spell, objects: [g, name, mana] });
    });
  }

  private updateSpellRows(): void {
    for (const row of this.spellRows) {
      const alpha = this.sim.hero.mana >= SPELL_DEFS[row.spell].mana ? 1 : 0.35;
      for (const o of row.objects) o.setAlpha(alpha);
    }
  }

  private updateParryHint(): void {
    const next = this.sim.incomingAttacks().sort((a, b) => a.timeToHit - b.timeToHit)[0];
    const counter = next ? (counterSpell(next.spell) ?? null) : null;
    if (counter === this.hintSpell) return;
    this.hintSpell = counter;
    this.hintGlyph.clear();
    if (!counter) {
      this.parryHint.setText('');
      return;
    }
    const inSet = this.set.includes(counter);
    this.parryHint.setText(`PARRY:    ${SPELL_DEFS[counter].name.toUpperCase()}${inSet ? '' : ' (not in pages)'}`);
    this.parryHint.setColor(css(inSet ? PAGE_INK.bad : PALETTE.parchmentLine));
    drawSpellGlyph(this.hintGlyph, counter, this.L.topPage.x + 64, this.L.spineY - 12, 12, 2);
  }

  // ------------------------------------------------------------ drawing input

  private insideCircle(p: Point): boolean {
    if (this.paused || this.ended) return false;
    const { circle } = this.L;
    return Math.hypot(p.x - circle.x, p.y - circle.y) <= circle.r + 6;
  }

  private onStrokeStart(p: Point, now: number): void {
    for (const intent of this.caster.strokeStart(now)) this.onIntent(intent);
    this.current = [p];
    this.ringState = 'active';
    if (!this.heroDown) this.hero.play(animKey('hero', 'draw'), true);
  }

  private onStrokeEnd(points: Point[], ms: number, now: number): void {
    this.waiting.push(points);
    this.current = [];
    for (const intent of this.caster.strokeEnd(points, ms, now)) this.onIntent(intent);
    if (this.ringState === 'active') this.ringState = 'idle';
    if (!this.heroDown && this.hero.anims.currentAnim?.key === animKey('hero', 'draw')) this.hero.play(animKey('hero', 'idle'));
  }

  private onIntent(intent: CastIntent): void {
    this.waiting = this.waiting.filter((s) => !intent.strokes.includes(s));
    if (intent.kind === 'fail') {
      this.sim.fizzle();
      this.fadeStrokes(intent.strokes, PALETTE.bad, true);
      this.flashRing('fail');
      sfx('fizzle');
      const glyph = intent.glyphs.find((g) => g !== null);
      const message =
        intent.reason === 'unrecognized'
          ? 'NOT RECOGNIZED'
          : intent.reason === 'notInSet' && glyph
            ? `${SPELL_DEFS[glyph].name.toUpperCase()} NOT IN PAGES`
            : 'NO SUCH COMBINATION';
      this.say(message, PAGE_INK.bad);
      return;
    }
    const result = this.sim.cast(intent.spell, intent.level);
    if (result.kind === 'noMana') {
      this.fadeStrokes(intent.strokes, PALETTE.bad, true);
      this.flashRing('fail');
      sfx('fizzle');
      this.say('NOT ENOUGH MANA', PAGE_INK.bad);
      return;
    }
    if (result.kind === 'idle') return;
    this.best.offer(intent.spell, intent.strokes, intent.drawMs);
    this.fadeStrokes(intent.strokes, spellColors(intent.spell)[0]!, false);
    this.flashRing('success');
    sfx('cast', SPELLS[intent.spell].elements);
    if (!this.heroDown) this.hero.play(animKey('hero', result.kind === 'parry' ? 'parry' : 'cast'));
    if (result.kind === 'attack') {
      const [text, color] = LEVEL_TEXT[intent.level];
      this.say(`${SPELL_DEFS[intent.spell].name.toUpperCase()}: ${text}`, color);
    }
    if (this.tutorial?.done(intent.spell, result)) this.endTutorial();
  }

  /** While a first glyph waits, the circle offers the glyphs that would complete a combination. */
  private updateComboHint(): void {
    const glyph = this.caster.waiting ? this.caster.waitingGlyph : null;
    if (glyph === this.comboHintFor) return;
    this.comboHintFor = glyph;
    this.comboHint.removeAll(true);
    if (!glyph) return;
    const options = this.caster.combosFor(glyph);
    const { circle } = this.L;
    const y = circle.y - circle.r + 18;
    const title = label(this, circle.x, y - 4, 'NOW ACROSS IT:', 8, PAGE_INK.gold, [0.5, 0.5]);
    this.comboHint.add(title);
    const step = 72;
    options.forEach((o, i) => {
      const x = circle.x + (i - (options.length - 1) / 2) * step;
      const g = this.add.graphics();
      drawSpellGlyph(g, o.with, x - 22, y + 14, 12, 2);
      this.comboHint.add([g, label(this, x - 12, y + 14, SPELL_DEFS[o.spell].name.toUpperCase(), 8, PAGE_INK.text, [0, 0.5])]);
    });
  }

  private drawInk(): void {
    this.ink.clear();
    this.ink.lineStyle(3, PALETTE.ink, 0.85);
    for (const stroke of [...this.waiting, this.current]) strokePolyline(this.ink, stroke);
  }

  private fadeStrokes(strokes: Point[][], color: number, crumble: boolean): void {
    const g = this.add.graphics().setDepth(52);
    g.lineStyle(3, color, 1);
    for (const s of strokes) strokePolyline(g, s);
    this.tweens.add({ targets: g, alpha: 0, duration: crumble ? 450 : 350, onComplete: () => g.destroy() });
    if (!crumble) return;
    for (const s of strokes) {
      for (let i = 0; i < s.length; i += 6) {
        const p = s[i]!;
        const bit = this.add.rectangle(p.x, p.y, 2, 2, color).setDepth(54);
        this.tweens.add({ targets: bit, y: p.y + 10 + Math.random() * 10, alpha: 0, duration: 450, onComplete: () => bit.destroy() });
      }
    }
  }

  private flashRing(state: 'success' | 'fail'): void {
    this.ringState = state;
    this.ringUntil = this.time.now + 260;
  }

  private drawRing(): void {
    if ((this.ringState === 'success' || this.ringState === 'fail') && this.time.now > this.ringUntil) {
      this.ringState = this.strokes.drawing ? 'active' : 'idle';
    }
    this.ring.clear();
    const { circle } = this.L;
    const color =
      this.ringState === 'active' ? PALETTE.gold : this.ringState === 'success' ? PAGE_INK.good : this.ringState === 'fail' ? PAGE_INK.bad : null;
    if (color !== null) this.ring.lineStyle(3, color, 0.9).strokeCircle(circle.x, circle.y, circle.r - 1);
    if (this.caster.waiting) this.ring.lineStyle(1, PALETTE.gold, 0.8).strokeCircle(circle.x, circle.y, circle.r - 14);
  }

  private say(text: string, color: number): void {
    this.feedback.setText(text).setColor(css(color)).setAlpha(1);
    this.tweens.killTweensOf(this.feedback);
    this.tweens.add({ targets: this.feedback, alpha: 0, delay: 900, duration: 400 });
  }

  // ------------------------------------------------------------ battlefield

  private sx(x: number): number {
    return this.L.fieldX0 + (x / this.sim.fieldLength) * (this.L.fx1 - 28 - this.L.fieldX0);
  }

  /** Screen x of an enemy: where its sprite is, which differs from its post while it comes out. */
  private enemyX(e: Enemy): number {
    return this.enemies.get(e.id)?.sprite.x ?? this.sx(e.x);
  }

  /** Height of the hero above the ground line, from the current frame. */
  private heroHeight(): number {
    return this.hero.displayHeight * this.hero.originY;
  }

  /** Screen y a little above the middle of an enemy, where its spells leave and the hero's land. */
  private chestY(enemyId: number | null): number {
    const view = enemyId === null ? undefined : this.enemies.get(enemyId);
    return view ? Math.round(view.ground - view.sprite.displayHeight * view.sprite.originY * 0.55) : GROUND - 40;
  }

  private heroChestY(): number {
    return GROUND - Math.round(this.heroHeight() * 0.5);
  }

  private has(set: string, anim: string): boolean {
    return this.anims.exists(animKey(set, anim));
  }

  /** Plays the first animation of the list that the set has. */
  private play(sprite: Phaser.GameObjects.Sprite, set: string, ...anims: string[]): void {
    const anim = anims.find((a) => this.has(set, a));
    if (anim) sprite.play(animKey(set, anim));
  }

  /** Keeps a looping base animation unless a one-shot is still running. */
  private applyBase(sprite: Phaser.GameObjects.Sprite, key: string, still: boolean): void {
    const anims = sprite.anims;
    const current = anims.currentAnim;
    if (anims.isPlaying && current && current.repeat !== -1) return;
    if (still) {
      if (anims.isPlaying || sprite.texture.key !== key) {
        anims.stop();
        sprite.setTexture(key, 0);
      }
      return;
    }
    if (!anims.isPlaying || current?.key !== key) sprite.play(key);
  }

  private syncEnemies(): void {
    for (const e of this.sim.enemies) {
      const view = this.enemies.get(e.id);
      if (!view) continue;
      // Coming out: from the far edge to its post, with a little step in its gait.
      const away = 1 - view.enter;
      view.sprite.x = Math.round(this.sx(e.x) + away * view.enterFrom);
      view.sprite.y = view.ground - (away > 0 ? Math.round(Math.abs(Math.sin(view.enter * Math.PI * 4)) * 3) : 0);
      // The enemy nearest the hero is drawn in front of the ones queued behind it.
      if (e.def.kind !== 'boss') view.sprite.setDepth(11 + (this.sim.fieldLength - e.x) / 1000);
      const winding = e.state === 'windup';
      const rest = this.has(view.set, 'idle') ? 'idle' : 'walk';
      const key = animKey(view.set, winding && this.has(view.set, 'cast') ? 'cast' : rest);
      // Walking placeholders freeze when they stop; standing enemies breathe and only a stun freezes them.
      const still = !winding && (e.stunLeft > 0 || (rest === 'walk' && e.state === 'ready'));
      this.applyBase(view.sprite, key, still);
    }
    if (!this.heroDown) {
      const base = animKey('hero', this.strokes.drawing ? 'draw' : 'idle');
      this.applyBase(this.hero, base, false);
    }
  }

  private syncShots(): void {
    const alive = new Set<number>();
    for (const p of this.sim.projectiles) {
      alive.add(p.id);
      let shot = this.shots.get(p.id);
      if (!shot) {
        const x = this.sx(p.x);
        const y = p.from === 'hero' ? this.heroChestY() : this.chestY(p.ownerId);
        shot = { sprite: this.shot(p.spell, x, y, p.from === 'enemy'), startX: x, startY: y };
        this.shots.set(p.id, shot);
      }
      // Height follows the flight from chest to chest, so shots reach enemies further up the road.
      const x = this.sx(p.x);
      const target = p.from === 'hero' ? this.sim.enemies.find((e) => e.id === p.targetId) : undefined;
      const endX = p.from === 'hero' ? (target ? this.enemyX(target) : this.L.fx1) : this.sx(0);
      const endY = p.from === 'hero' ? (target ? this.chestY(target.id) : shot.startY) : this.heroChestY();
      const t = endX === shot.startX ? 1 : Math.max(0, Math.min(1, (x - shot.startX) / (endX - shot.startX)));
      shot.sprite.setPosition(Math.round(x), Math.round(shot.startY + (endY - shot.startY) * t));
    }
    for (const [id, shot] of this.shots) {
      if (alive.has(id)) continue;
      shot.sprite.destroy();
      this.shots.delete(id);
    }
  }

  /** A spell in flight, heading right for the hero's and left for an enemy's. */
  private shot(spell: SpellKey, x: number, y: number, leftward: boolean): Phaser.GameObjects.Sprite {
    const set = spellFx(spell);
    if (!this.has(set, 'fly')) {
      return this.add.sprite(x, y, projectileKey(spell)).setScale(SHOT_SCALE).setDepth(20).setFlipX(leftward);
    }
    const [ax, ay] = SPRITES[set]!.anchor;
    return this.add
      .sprite(x, y, animKey(set, 'fly'))
      .setOrigin(leftward ? 1 - ax : ax, ay)
      .setScale(spriteScale(set))
      .setFlipX(leftward)
      .setDepth(20)
      .play(animKey(set, 'fly'));
  }

  /** The spell bursting where it landed (its flight's `hit` frames), plus a few sparks. */
  private impact(spell: SpellKey, x: number, y: number, leftward: boolean): void {
    const set = spellFx(spell);
    if (this.has(set, 'hit')) {
      const [ax, ay] = SPRITES[set]!.anchor;
      const sprite = this.add
        .sprite(x, y, animKey(set, 'hit'))
        .setOrigin(leftward ? 1 - ax : ax, ay)
        .setScale(spriteScale(set))
        .setFlipX(leftward)
        .setDepth(64);
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
      sprite.play(animKey(set, 'hit'));
    }
    this.burst(x, y, spellColors(spell), 8);
  }

  private bar(cx: number, y: number, w: number, fraction: number, color: number): void {
    const left = Math.round(cx - w / 2);
    this.fx.fillStyle(0x000000, 0.65).fillRect(left - 1, y - 1, w + 2, 5);
    this.fx.fillStyle(color, 1).fillRect(left, y, Math.round(w * Math.max(0, Math.min(1, fraction))), 3);
  }

  private drawOverlay(): void {
    this.fx.clear();
    const { hero } = this.sim;
    this.bar(this.L.heroX, GROUND + 6, 64, hero.hp / hero.maxHp, PALETTE.hp);
    this.bar(this.L.heroX, GROUND + 12, 64, hero.mana / hero.maxMana, PALETTE.mana);
    for (const e of this.sim.enemies) {
      const view = this.enemies.get(e.id);
      // Its bars come up once it stands at its post.
      if (view && view.enter < 1) continue;
      const x = this.enemyX(e);
      const w = view ? Math.round(Math.min(110, view.sprite.displayWidth * 0.5)) : 26;
      const ground = view?.ground ?? GROUND;
      this.bar(x, ground + 6, w, e.hp / e.maxHp, PALETTE.hp);
      if (e.def.element) drawElementIcon(this.fx, e.def.element, Math.round(x - w / 2 - 7), ground + 7, 3);
      if (e.state === 'windup' && e.casting && view) this.sparks(e, view);
    }
    const boss = this.sim.enemies.find((e) => e.def.kind === 'boss');
    if (boss) {
      const x0 = this.L.fx0 + 60;
      const w = this.L.fx1 - x0 - 16;
      this.fx.fillStyle(0x000000, 0.65).fillRect(x0 - 2, 30, w + 4, 8);
      this.fx.fillStyle(PALETTE.hp, 1).fillRect(x0, 32, Math.round(w * (boss.hp / boss.maxHp)), 4);
      this.bossName ??= label(this, x0, 18, boss.def.name.toUpperCase(), 8, PALETTE.text).setDepth(26);
    } else if (this.bossName) {
      this.bossName.destroy();
      this.bossName = null;
    }
  }

  /** Sparks of the spell's elements above the caster; they close in as the cast nears. */
  private sparks(e: Enemy, view: EnemyView): void {
    const { sprite } = view;
    const cast = this.sim.castOf(e);
    const progress = cast ? Math.max(0, Math.min(1, 1 - e.timer / cast.windup)) : 0;
    const colors = spellColors(e.casting!);
    const anchor = { x: sprite.x - sprite.displayWidth * 0.1, y: Math.max(SPARKS_TOP, view.ground - sprite.displayHeight * sprite.originY - 12) };
    const radius = 5 + 12 * (1 - progress);
    const spin = this.time.now / 160;
    for (let k = 0; k < 8; k++) {
      const a = spin + (k / 8) * Math.PI * 2;
      this.fx.fillStyle(colors[k % colors.length]!, 1);
      this.fx.fillRect(Math.round(anchor.x + Math.cos(a) * radius) - 1, Math.round(anchor.y + Math.sin(a) * radius * 0.7) - 1, 3, 3);
    }
  }

  private createEnemyView(id: number): void {
    const e = this.sim.enemies.find((o) => o.id === id);
    if (!e) return;
    const set = e.def.sprite;
    const key = animKey(set, this.has(set, 'idle') ? 'idle' : 'walk');
    const [ox, oy] = SPRITES[set]?.anchor ?? [0.5, 1];
    const post = this.sx(e.x);
    const sprite = this.add
      .sprite(post, GROUND, key)
      .setOrigin(ox, oy)
      .setScale(spriteScale(set))
      .setDepth(e.def.kind === 'boss' ? 9 : 11);
    const tint = spriteTint(set);
    if (tint !== null) sprite.setTint(tint);
    sprite.play(key);
    const view: EnemyView = { sprite, set, ground: GROUND, enter: 1, enterFrom: 0 };
    // A standing enemy comes out from behind the far edge of the field while the battle
    // gives it BALANCE.entrance before it acts; walkers enter on their own feet.
    if (e.def.speed === 0 && BALANCE.entrance > 0) {
      const ms = BALANCE.entrance * 1000;
      view.enter = 0;
      view.enterFrom = Math.max(0, this.L.fx1 + sprite.displayWidth * ox - post);
      this.tweens.add({ targets: view, enter: 1, duration: ms, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: sprite, alpha: { from: 0, to: 1 }, duration: ms * 0.4 });
    }
    this.enemies.set(id, view);
  }

  /**
   * Colours an enemy for a moment, for sets drawn without the pose (the boss has no hurt or phase
   * drawing yet). Its own tint comes back unless it has died meanwhile.
   */
  private flash(enemyId: number, color: number, mode: Phaser.TintModes, ms: number): void {
    const view = this.enemies.get(enemyId);
    if (!view) return;
    view.sprite.setTint(color).setTintMode(mode);
    this.time.delayedCall(ms, () => {
      if (this.enemies.get(enemyId) !== view) return;
      view.sprite.clearTint();
      const tint = spriteTint(view.set);
      if (tint !== null) view.sprite.setTint(tint);
    });
  }

  private float(x: number, y: number, text: string, color: number, size = 8): void {
    const t = label(this, x, y, text, size, color, [0.5, 1]).setDepth(70).setStroke('#141019', 3);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 750, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private burst(x: number, y: number, colors: number[], count = 10): void {
    for (let i = 0; i < count; i++) {
      const bit = this.add.rectangle(x, y, 3, 3, colors[i % colors.length]!).setDepth(65);
      this.tweens.add({
        targets: bit,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.7) * 32,
        alpha: 0,
        duration: 350 + Math.random() * 150,
        onComplete: () => bit.destroy(),
      });
    }
  }

  private banner(text: string): void {
    const cx = (this.L.fx0 + this.L.fx1) / 2;
    const t = label(this, cx, 80, text, 16, PALETTE.gold, [0.5, 0.5]).setDepth(75).setStroke('#141019', 4).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 200, yoyo: true, hold: 900, onComplete: () => t.destroy() });
  }

  private heroHurt(damage: number): void {
    if (this.heroDown) return;
    this.play(this.hero, 'hero', 'hurt');
    this.float(this.L.heroX, GROUND - this.heroHeight() - 2, `-${Math.round(damage)}`, PALETTE.bad);
    this.cameras.main.shake(120, 0.006);
    sfx('hurt');
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'wave':
        // The battle's name opens the first wave; each next enemy comes out under a banner.
        if (e.total > 1) {
          this.waveLabel.setText(`WAVE ${e.index + 1}/${e.total}`);
          if (e.index > 0) this.banner(`WAVE ${e.index + 1}/${e.total}`);
        }
        break;
      case 'spawn':
        this.createEnemyView(e.enemyId);
        break;
      case 'backfire':
        this.play(this.hero, 'hero', 'fail');
        this.burst(this.L.heroX + 8, GROUND - Math.round(this.heroHeight() * 0.45), [0xff8a3c, 0xffe08a]);
        this.float(this.L.heroX, GROUND - this.heroHeight() - 2, `-${Math.round(e.damage)}`, PALETTE.bad);
        this.cameras.main.shake(100, 0.005);
        this.say('UNSTABLE: BACKFIRE!', PAGE_INK.warn);
        break;
      case 'hit': {
        const view = this.enemies.get(e.enemyId);
        if (!view) break;
        const y = this.chestY(e.enemyId);
        this.impact(e.spell, view.sprite.x - view.sprite.displayWidth * 0.15, y, false);
        if (e.affinity !== 'immune') {
          if (this.has(view.set, 'hurt')) this.play(view.sprite, view.set, 'hurt');
          else this.flash(e.enemyId, 0xff7a7a, Phaser.TintModes.MULTIPLY, 140);
        }
        // One flash at a time: stacked yoyo tweens would leave a busy enemy half transparent.
        this.tweens.killTweensOf(view.sprite);
        this.tweens.add({ targets: view.sprite, alpha: { from: 0.5, to: 1 }, duration: 140 });
        const dmg = Math.round(e.damage);
        if (e.affinity === 'weak') {
          this.float(view.sprite.x, y - 8, `${dmg} WEAK!`, PALETTE.gold);
          sfx('weak');
        } else if (e.affinity === 'resist') {
          this.float(view.sprite.x, y - 8, `${dmg} RESIST`, PALETTE.dim);
          sfx('resist');
        } else if (e.affinity === 'immune') {
          this.float(view.sprite.x, y - 8, 'IMMUNE', PALETTE.dim);
          sfx('resist');
        } else {
          this.float(view.sprite.x, y - 8, `${dmg}`, PALETTE.text);
          sfx('hit');
        }
        break;
      }
      case 'enemyParry': {
        const view = this.enemies.get(e.enemyId);
        if (!view) break;
        this.play(view.sprite, view.set, 'parry', 'release');
        this.burst(view.sprite.x - view.sprite.displayWidth * 0.25, this.chestY(e.enemyId), [...spellColors(e.spell), 0xffffff], 12);
        this.float(view.sprite.x, view.ground - view.sprite.displayHeight * view.sprite.originY - 4, 'PARRIED', PALETTE.text);
        this.say('YOUR SPELL WAS PARRIED', PAGE_INK.bad);
        sfx('parry');
        break;
      }
      case 'parry': {
        this.play(this.hero, 'hero', 'parry');
        const x = Math.max(this.L.fieldX0 + 24, this.sx(e.x) - 32);
        const y = this.heroChestY();
        const enemySpell = counterSpell(e.spell);
        if (enemySpell) this.impact(enemySpell, x, y, true);
        this.burst(x, y, [...spellColors(e.spell), ...(enemySpell ? spellColors(enemySpell) : []), 0xffffff], 16);
        this.float(x, y - 30, 'PARRY!', PALETTE.gold, 16);
        this.say('PARRY!', PAGE_INK.gold);
        sfx('parry');
        break;
      }
      case 'windup':
        sfx('windup');
        if (this.parryLessonDue && !this.tutorial) {
          this.parryLessonDue = false;
          this.parryLesson(e.enemyId, e.spell);
        }
        break;
      case 'release': {
        const view = this.enemies.get(e.enemyId);
        if (view) this.play(view.sprite, view.set, 'release');
        break;
      }
      case 'melee': {
        const view = this.enemies.get(e.enemyId);
        if (view) this.play(view.sprite, view.set, 'attack');
        this.heroHurt(e.damage);
        break;
      }
      case 'heroHit': {
        const y = this.heroChestY();
        if (e.spell) this.impact(e.spell, this.L.heroX + 16, y, true);
        else this.burst(this.L.heroX + 10, y, [PALETTE.bad]);
        this.heroHurt(e.damage);
        break;
      }
      case 'death': {
        const view = this.enemies.get(e.enemyId);
        if (!view) break;
        this.enemies.delete(e.enemyId);
        if (this.has(view.set, 'death')) {
          this.play(view.sprite, view.set, 'death');
          // The death pose (a spirit leaving the body) stays a moment before it fades.
          this.tweens.add({ targets: view.sprite, alpha: 0, delay: this.has(view.set, 'idle') ? 1000 : 350, duration: 400, onComplete: () => view.sprite.destroy() });
        } else {
          // Drawn without a death pose (the boss, for now): it burns white and rises away.
          const { sprite } = view;
          this.tweens.killTweensOf(sprite);
          sprite.anims.stop();
          sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL).setAlpha(1);
          this.cameras.main.shake(260, 0.008);
          for (let i = 0; i < 3; i++) {
            const y = view.ground - sprite.displayHeight * sprite.originY * (0.25 + i * 0.3);
            this.time.delayedCall(i * 160, () => this.burst(sprite.x, y, [0xffffff, 0xf3c6f0, 0xc58ad8], 14));
          }
          this.tweens.add({ targets: sprite, alpha: 0, y: sprite.y - 24, duration: 1000, ease: 'Quad.easeIn', onComplete: () => sprite.destroy() });
        }
        sfx('death');
        break;
      }
      case 'phase': {
        const view = this.enemies.get(e.enemyId);
        if (view && this.has(view.set, 'phase')) this.play(view.sprite, view.set, 'phase');
        else this.flash(e.enemyId, 0xffffff, Phaser.TintModes.FILL, 260);
        const boss = this.sim.enemies.find((o) => o.id === e.enemyId);
        const weak = boss?.def.phases[e.phase]?.weak ?? [];
        this.cameras.main.flash(250, 255, 255, 255);
        this.banner('THE WARDEN SHIFTS');
        if (weak.length) this.time.delayedCall(1200, () => this.banner(`NOW WEAK TO ${weak.join(' + ').toUpperCase()}`));
        break;
      }
      case 'victory':
        this.end(true);
        break;
      case 'defeat':
        this.end(false);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ tutorial, pause, end

  /** Strokes of a glyph inside the circle, for the hand to trace. */
  private glyphPath(element: Element, size: number, dx = 0, dy = 0): Point[] {
    const { circle } = this.L;
    const points = DEFAULT_TEMPLATES.find((t) => t.glyph === element)!.points;
    return resample(points, 60).map((p) => ({ x: circle.x + dx + (p.x - 0.5) * size, y: circle.y + dy + (p.y - 0.45) * size }));
  }

  /**
   * Holds the battle and shows how to draw: faint guides, a hand tracing the strokes in turn,
   * and a line of text over the field. `done` says which cast ends it.
   */
  private teach(lesson: Lesson, text: string, strokes: { element: Element; path: Point[] }[], done: Tutorial['done']): void {
    const { fx0, fx1 } = this.L;
    const guide = this.add.graphics().setDepth(51);
    for (const s of strokes) {
      guide.lineStyle(4, ELEMENT_COLOR[s.element], 0.3);
      strokePolyline(guide, s.path);
    }
    const path = strokes.flatMap((s) => s.path);
    const hand = this.add.image(path[0]!.x, path[0]!.y, 'tutorial_hand').setOrigin(0.35, 0.05).setScale(2).setDepth(56);
    const width = fx1 - fx0 - 40;
    const caption = label(this, (fx0 + fx1) / 2, 58, text, 8, PALETTE.text, [0.5, 0], width).setAlign('center').setDepth(61);
    const shade = this.add
      .rectangle((fx0 + fx1) / 2, 52, width + 16, caption.height + 14, PALETTE.night, 0.8)
      .setOrigin(0.5, 0)
      .setStrokeStyle(1, PALETTE.gold)
      .setDepth(60);
    const tween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1800 * strokes.length,
      repeat: -1,
      repeatDelay: 500,
      onUpdate: (tw) => {
        const p = path[Math.floor((tw.getValue() ?? 0) * (path.length - 1))]!;
        hand.setPosition(p.x, p.y);
      },
    });
    this.tutorial = { lesson, objects: [hand, guide, caption, shade], tween, done };
  }

  /** Battle 1: draw the first glyph. */
  private drawLesson(): void {
    const size = this.L.circle.r * 1.15;
    this.teach('draw', 'Magic is drawn. Trace the FIRE glyph inside the circle on your grimoire, in one stroke.', [{ element: 'fire', path: this.glyphPath('fire', size) }], (spell) => spell === 'fire');
    this.parryLessonDue = true;
  }

  /** Battle 1, on the first enemy cast: answer it with the opposite element. */
  private parryLesson(enemyId: number, spell: SpellKey): void {
    const counter = counterSpell(spell);
    const enemy = this.sim.enemies.find((e) => e.id === enemyId);
    if (!counter || !enemy || !this.set.includes(counter) || SPELLS[counter].elements.length > 1) return;
    const element = SPELLS[counter].elements[0]!;
    const size = this.L.circle.r * 1.15;
    this.teach(
      'parry',
      `${enemy.def.name} is casting ${SPELL_DEFS[spell].name.toUpperCase()}: see the sparks above it. Draw ${SPELL_DEFS[counter].name.toUpperCase()} now to PARRY it. Opposites cancel.`,
      [{ element, path: this.glyphPath(element, size) }],
      (_spell, result) => result.kind === 'parry',
    );
  }

  /** Battle 3: two glyphs crossed make a combination. */
  private comboLesson(combo: SpellKey): void {
    const [a, b] = SPELLS[combo].elements as [Element, Element];
    const size = this.L.circle.r * 1.0;
    this.teach(
      'combo',
      `COMBINATION: draw ${a.toUpperCase()}, then right away draw ${b.toUpperCase()} across it. Together they cast ${SPELL_DEFS[combo].name.toUpperCase()}.`,
      [
        { element: a, path: this.glyphPath(a, size) },
        { element: b, path: this.glyphPath(b, size * 0.9, 0, 6) },
      ],
      (spell) => isCombo(spell),
    );
  }

  private endTutorial(): void {
    const t = this.tutorial;
    if (!t) return;
    t.tween.stop();
    for (const o of t.objects) o.destroy();
    this.tutorial = null;
    const { profile } = app();
    if (t.lesson === 'draw') {
      this.banner('WELL DONE');
    } else if (t.lesson === 'parry') {
      profile.settings.tutorialDone = true;
      void profile.saveSettings();
      this.banner('PARRIED!');
    } else {
      profile.settings.comboTutorialDone = true;
      void profile.saveSettings();
      this.banner('COMBINATION!');
    }
  }

  private pause(): void {
    if (this.paused || this.ended) return;
    this.paused = true;
    this.strokes.enabled = false;
    const W = this.L.W;
    const H = this.L.H;
    const objects: { destroy(): void }[] = [];
    const shade = this.add.rectangle(0, 0, W, H, PALETTE.night, 0.7).setOrigin(0, 0).setInteractive().setDepth(400);
    const box = panel(this, W / 2 - 120, H / 2 - 90, 240, 180).setDepth(401);
    const title = label(this, W / 2, H / 2 - 74, 'PAUSED', 16, PALETTE.gold, [0.5, 0]).setDepth(402);
    objects.push(shade, box, title);
    const resume = () => {
      for (const o of objects) o.destroy();
      this.paused = false;
      this.strokes.enabled = true;
    };
    const buttons = [
      new Button(this, W / 2, H / 2 - 24, 'Resume', resume, { tone: 'primary', width: 180 }),
      new Button(this, W / 2, H / 2 + 14, 'Settings', () => openSettings(this, () => undefined, 'Grimoire side applies next battle.'), { width: 180 }),
      new Button(this, W / 2, H / 2 + 52, 'Leave battle', () => {
        void app().profile.savePages(this.best.pages());
        go(this, 'menu');
      }, { width: 180 }),
    ];
    for (const b of buttons) {
      b.bg.setDepth(402);
      b.text.setDepth(403);
      objects.push(b);
    }
  }

  private end(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.strokes.enabled = false;
    this.pauseButton.setVisible(false);
    if (won) {
      sfx('victory');
      this.banner('VICTORY');
    } else {
      sfx('defeat');
      this.heroDown = true;
      this.play(this.hero, 'hero', 'defeat');
      this.banner('DEFEAT');
    }
    const { profile } = app();
    const stats = { durationMs: Date.now() - this.startedAt, casts: this.sim.stats.casts, precise: this.sim.stats.precise, parries: this.sim.stats.parries };
    const before = profile.known;
    const newSpells = won ? knownSpells([...profile.cleared, this.battleId]).filter((s) => !before.includes(s)) : [];
    const save = finishRun({ battleId: this.battleId, won, runToken: this.runToken, stats, pages: this.best.pages() });
    this.time.delayedCall(1500, () => go(this, 'result', { battleId: this.battleId, won, stats, newSpells, save }));
  }
}
