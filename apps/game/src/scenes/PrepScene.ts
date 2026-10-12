import { battleById, counterSpell, SPELL_KEYS, spellsForBattle, type SpellKey } from '@grimoire/glyphs';
import Phaser from 'phaser';
import { app } from '../app';
import { animKey, SPRITES, spriteTint } from '../assets/sprites';
import { battleDef, enemyDef, SPELL_DEFS, type EnemyDef } from '../content';
import { drawSpellGlyph } from '../ui/glyphs';
import { PALETTE } from '../ui/theme';
import { Button, label, panel } from '../ui/widgets';
import { backdrop, fadeIn, go } from './common';

interface Card {
  spell: SpellKey;
  frame: Phaser.GameObjects.Rectangle;
  mark: Phaser.GameObjects.Text;
}

/** Before a battle: who is coming and which spells go into the limited pages. */
export class PrepScene extends Phaser.Scene {
  private battleId = '';
  private limit = 0;
  private chosen: SpellKey[] = [];
  private cards: Card[] = [];
  private counter!: Phaser.GameObjects.Text;
  private start!: Button;

  constructor() {
    super('prep');
  }

  init(data: { battleId: string }): void {
    this.battleId = data.battleId;
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.55);
    const { profile } = app();
    const W = this.scale.width;
    const progress = battleById(this.battleId)!;
    const battle = battleDef(this.battleId);
    this.limit = progress.pageLimit;
    this.cards = [];

    const lw = Math.round(W * 0.42);
    panel(this, 12, 12, lw, 336);
    label(this, 24, 24, battle.name.toUpperCase(), 8, PALETTE.gold, [0, 0], lw - 24);
    label(this, 24, 42, battle.brief, 8, PALETTE.text, [0, 0], lw - 24);
    const spawns = battle.waves.flatMap((w) => w.spawns.map((s) => s.enemy));
    const keys = [...new Set(spawns)];
    const count = (key: string) => spawns.filter((k) => k === key).length;
    label(this, 24, 108, spawns.length === 1 ? 'ENEMY' : 'ENEMIES, ONE AT A TIME', 8, PALETTE.dim);
    if (keys.length === 1) this.duelist(enemyDef(keys[0]!), count(keys[0]!), 24, 124, lw - 24);
    else keys.slice(0, 3).forEach((key, i) => this.enemyCard(enemyDef(key), count(key), 24, 122 + i * 74));

    const known = new Set<SpellKey>([...spellsForBattle(this.battleId), ...profile.known]);
    const available = SPELL_KEYS.filter((k) => known.has(k));
    const x0 = lw + 24;
    const rw = W - x0 - 12;
    panel(this, x0 - 4, 12, rw + 4, 336);
    label(this, x0 + 8, 24, 'GRIMOIRE PAGES', 8, PALETTE.dim);
    this.counter = label(this, x0 + rw - 12, 24, '', 8, PALETTE.gold, [1, 0]);
    const cardH = Math.min(36, Math.floor(250 / Math.max(available.length, 1)) - 4);
    available.forEach((spell, i) => this.card(spell, x0 + 8, 42 + i * (cardH + 4), rw - 20, cardH));

    this.chosen = this.defaultSet(available, profile.settings.sets[this.battleId]);
    new Button(this, x0 + 60, 326, 'Back', () => go(this, 'menu'), { width: 96, tone: 'quiet' });
    this.start = new Button(this, x0 + rw - 80, 326, 'Start battle', () => this.begin(), { tone: 'primary', width: 140 });
    this.refresh();
  }

  /** The battle's only kind of enemy, life-size, with what hurts it and what answers its spells. */
  private duelist(def: EnemyDef, count: number, x: number, y: number, w: number): void {
    const set = def.sprite;
    // The casting pose shows the enemy at its most telling (the slime mage puts on its hat).
    const idle = ['cast', 'idle', 'walk'].map((a) => animKey(set, a)).find((k) => this.anims.exists(k)) ?? animKey(set, 'walk');
    const [ox, oy] = SPRITES[set]?.anchor ?? [0.5, 1];
    const sprite = this.add.sprite(x + 56, y + 150, idle).setOrigin(ox, oy);
    const tint = spriteTint(set);
    if (tint !== null) sprite.setTint(tint);
    if (this.anims.exists(idle)) sprite.play(idle);
    const tx = x + 124;
    label(this, tx, y + 8, count > 1 ? `${def.name} x${count}` : def.name, 8, PALETTE.text, [0, 0], w - 124);
    const g = this.add.graphics();
    const phases = def.kind === 'boss' ? def.phases : [{ weak: def.weak, cast: def.cast }];
    label(this, tx, y + 40, 'Weak to', 8, PALETTE.dim);
    this.glyphRow(g, phases.map((p) => [...p.weak]), tx, y + 64);
    label(this, tx, y + 92, 'Parry with', 8, PALETTE.dim);
    const counters = phases.map((p) => [...new Set((p.cast?.spells ?? []).map((s) => counterSpell(s)).filter((s): s is SpellKey => s !== undefined))]);
    this.glyphRow(g, counters, tx, y + 116);
  }

  /** One of several enemy kinds: a half-size figure, its weakness and its parry, in a 70 px row. */
  private enemyCard(def: EnemyDef, count: number, x: number, y: number): void {
    const set = def.sprite;
    const pose = ['cast', 'idle', 'walk'].map((a) => animKey(set, a)).find((k) => this.anims.exists(k));
    if (pose) {
      const [ox, oy] = SPRITES[set]?.anchor ?? [0.5, 1];
      const sprite = this.add.sprite(x + 30, y + 66, pose).setOrigin(ox, oy).setScale(0.5).play(pose);
      const tint = spriteTint(set);
      if (tint !== null) sprite.setTint(tint);
    }
    const tx = x + 70;
    label(this, tx, y + 2, count > 1 ? `${def.name} x${count}` : def.name, 8, PALETTE.text);
    const g = this.add.graphics();
    label(this, tx, y + 24, 'Weak', 8, PALETTE.dim);
    this.glyphRow(g, [[...def.weak]], tx + 52, y + 28);
    label(this, tx, y + 50, 'Parry', 8, PALETTE.dim);
    const counters = [...new Set((def.cast?.spells ?? []).map((s) => counterSpell(s)).filter((s): s is SpellKey => s !== undefined))];
    this.glyphRow(g, [counters], tx + 52, y + 54);
  }

  /** Glyphs to draw, one group per boss phase, separated by ">". */
  private glyphRow(g: Phaser.GameObjects.Graphics, groups: SpellKey[][], x: number, y: number): void {
    let cx = x;
    groups.forEach((group, i) => {
      if (i > 0) {
        label(this, cx, y - 4, '>', 8, PALETTE.dim);
        cx += 14;
      }
      for (const spell of group) {
        g.fillStyle(PALETTE.parchment, 1).fillRect(cx, y - 11, 22, 22);
        drawSpellGlyph(g, spell, cx + 11, y, 14, 2);
        cx += 26;
      }
    });
  }

  private card(spell: SpellKey, x: number, y: number, w: number, h: number): void {
    const def = SPELL_DEFS[spell];
    const frame = this.add
      .rectangle(x, y, w, h, PALETTE.inkLight)
      .setOrigin(0, 0)
      .setStrokeStyle(2, PALETTE.dim)
      .setInteractive({ useHandCursor: true });
    frame.on('pointerup', () => this.toggle(spell));
    const g = this.add.graphics();
    g.fillStyle(PALETTE.parchment, 1).fillRect(x + 4, y + 3, h - 6, h - 6);
    drawSpellGlyph(g, spell, x + 4 + (h - 6) / 2, y + h / 2, h - 14, 2);
    const name = label(this, x + h + 4, y + 5, def.name.toUpperCase(), 8, PALETTE.text);
    label(this, name.x + name.width + 12, y + 5, def.text, 8, PALETTE.dim);
    label(this, x + h + 4, y + h - 13, `DMG ${def.damage}  MANA ${def.mana}`, 8, PALETTE.dim);
    label(this, x + w - 8, y + 5, `${def.pages}p`, 8, PALETTE.gold, [1, 0]);
    const mark = label(this, x + w - 8, y + h - 13, '', 8, PALETTE.good, [1, 0]);
    this.cards.push({ spell, frame, mark });
  }

  private used(set: readonly SpellKey[] = this.chosen): number {
    return set.reduce((sum, s) => sum + SPELL_DEFS[s].pages, 0);
  }

  private defaultSet(available: SpellKey[], saved: SpellKey[] | undefined): SpellKey[] {
    const order = saved?.length ? saved : [...battleById(this.battleId)!.unlocks, ...available];
    const set: SpellKey[] = [];
    for (const spell of order) {
      if (!available.includes(spell) || set.includes(spell)) continue;
      if (this.used(set) + SPELL_DEFS[spell].pages <= this.limit) set.push(spell);
    }
    return set;
  }

  private toggle(spell: SpellKey): void {
    if (this.chosen.includes(spell)) this.chosen = this.chosen.filter((s) => s !== spell);
    else if (this.used() + SPELL_DEFS[spell].pages <= this.limit) this.chosen = [...this.chosen, spell];
    this.refresh();
  }

  private refresh(): void {
    this.counter.setText(`${this.used()}/${this.limit}`);
    for (const card of this.cards) {
      const on = this.chosen.includes(card.spell);
      const fits = on || this.used() + SPELL_DEFS[card.spell].pages <= this.limit;
      card.frame.setStrokeStyle(2, on ? PALETTE.gold : PALETTE.dim).setAlpha(fits ? 1 : 0.55);
      card.mark.setText(on ? 'IN SET' : fits ? '' : 'NO ROOM');
      card.mark.setColor(on ? '#7bd36a' : '#9a8fae');
    }
    this.start.setEnabled(this.chosen.length > 0);
  }

  private begin(): void {
    const { profile } = app();
    profile.settings.sets[this.battleId] = this.chosen;
    void profile.saveSettings();
    go(this, 'battle', { battleId: this.battleId, set: this.chosen });
  }
}
