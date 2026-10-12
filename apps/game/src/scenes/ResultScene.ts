import { battleById, nextBattle, type SpellKey } from '@grimoire/glyphs';
import Phaser from 'phaser';
import { app } from '../app';
import { sfx } from '../audio/sfx';
import { explorerAddress } from '../config';
import { SPELL_DEFS } from '../content';
import { ENDING_CARDS } from '../content/story';
import type { GrimoireWrite, RunStats } from '../relayer/client';
import { syncGrimoire, type SaveOutcome } from '../state/runs';
import { drawSpellGlyph } from '../ui/glyphs';
import { PALETTE } from '../ui/theme';
import { Button, label, openLink, panel } from '../ui/widgets';
import { backdrop, fadeIn, go } from './common';

export interface ResultData {
  battleId: string;
  won: boolean;
  stats: RunStats;
  newSpells: SpellKey[];
  save: Promise<SaveOutcome>;
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Victory or defeat, the spells just recorded, and where the grimoire was written. */
export class ResultScene extends Phaser.Scene {
  private result!: ResultData;
  private line!: Phaser.GameObjects.Text;
  private action: Button | null = null;
  private actionY = 0;

  constructor() {
    super('result');
  }

  init(data: ResultData): void {
    this.result = data;
    this.action = null;
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.6);
    const W = this.scale.width;
    const pw = Math.min(560, W - 48);
    const px = Math.round((W - pw) / 2);
    const py = 20;
    panel(this, px, py, pw, 320);
    const { won, stats } = this.result;
    label(this, W / 2, py + 16, won ? 'VICTORY' : 'DEFEAT', 16, won ? PALETTE.gold : PALETTE.bad, [0.5, 0]);
    const accuracy = stats.casts > 0 ? Math.round((100 * stats.precise) / stats.casts) : 0;
    label(this, W / 2, py + 46, `Time ${clock(stats.durationMs)}   Casts ${stats.casts}   Precise ${accuracy}%   Parries ${stats.parries}`, 8, PALETTE.text, [0.5, 0]);

    if (won && this.result.newSpells.length > 0) {
      sfx('record');
      label(this, W / 2, py + 76, 'MAGIC RECORDED IN YOUR GRIMOIRE', 8, PALETTE.gold, [0.5, 0]);
      const spells = this.result.newSpells;
      const g = this.add.graphics();
      spells.forEach((spell, i) => {
        const cx = W / 2 + (i - (spells.length - 1) / 2) * 80;
        g.fillStyle(PALETTE.parchment, 1).fillRect(cx - 26, py + 96, 52, 52);
        drawSpellGlyph(g, spell, cx, py + 122, 36, 2);
        label(this, cx, py + 154, SPELL_DEFS[spell].name, 8, PALETTE.text, [0.5, 0]);
      });
    }

    this.line = label(this, W / 2, py + 190, 'Saving...', 8, PALETTE.dim, [0.5, 0], pw - 40).setAlign('center');
    this.actionY = py + 240;
    void this.result.save.then((outcome) => this.showOutcome(outcome));

    const by = py + 296;
    if (won) {
      new Button(this, W / 2, by, battleById(this.result.battleId)?.boss ? 'Continue' : 'Next battle', () => this.next(), { tone: 'primary', width: 180 });
    } else {
      new Button(this, W / 2 - 100, by, 'Try again', () => go(this, 'prep', { battleId: this.result.battleId }), { tone: 'primary', width: 160 });
      new Button(this, W / 2 + 100, by, 'Menu', () => go(this, 'menu'), { width: 160 });
    }
  }

  private setAction(caption: string, onPress: () => void): void {
    this.action?.destroy();
    this.action = new Button(this, this.scale.width / 2, this.actionY, caption, onPress, { width: 260 });
  }

  private showWrite(write: GrimoireWrite, counted = true): void {
    const note = counted ? '' : '\nThis win was not counted on-chain (battle order or timing).';
    switch (write.status) {
      case 'written':
      case 'pending':
        this.line.setText(`Saved to your on-chain grimoire${write.status === 'pending' ? ' (confirming)' : ''}.${note}`).setColor('#7bd36a');
        this.setAction('View on Solana Explorer', () => openLink(explorerAddress(write.asset)));
        break;
      case 'unchanged':
        this.line.setText(`Your on-chain grimoire is up to date.${note}`).setColor('#f3ead2');
        this.setAction('View on Solana Explorer', () => openLink(explorerAddress(write.asset)));
        break;
      case 'no-wallet':
        this.line.setText('Link a wallet to keep it on Solana.').setColor('#e0b44c');
        if (app().account.mode === 'idos') this.setAction('Link wallet', () => void this.link());
        break;
      case 'error':
        this.line.setText(`The grimoire was not written: ${write.error}`).setColor('#e0614f');
        break;
    }
  }

  private showOutcome(outcome: SaveOutcome): void {
    switch (outcome.kind) {
      case 'saved':
        this.showWrite(outcome.grimoire, outcome.counted);
        break;
      case 'offline':
        this.line.setText('Progress saved on this device. Solana sync is off here.');
        break;
      case 'lost':
        this.line.setText('Your best drawings are kept in the grimoire.');
        break;
      case 'error':
        this.line.setText(`Could not reach the grimoire relayer (${outcome.message}). Progress is saved.`).setColor('#e0614f');
        break;
    }
  }

  private async link(): Promise<void> {
    this.action?.setEnabled(false);
    this.line.setText('Linking wallet...').setColor('#9a8fae');
    const linked = await app().account.linkWallet();
    if (!linked.ok) {
      this.line.setText(`Could not link the wallet: ${linked.error}`).setColor('#e0614f');
      this.action?.setEnabled(true);
      return;
    }
    this.line.setText('Writing your grimoire...');
    this.showWrite(await syncGrimoire());
  }

  private next(): void {
    if (battleById(this.result.battleId)?.boss) {
      go(this, 'story', { cards: ENDING_CARDS, next: { key: 'menu' } });
      return;
    }
    const upcoming = nextBattle(app().profile.cleared);
    go(this, 'prep', { battleId: upcoming?.id ?? this.result.battleId });
  }
}
