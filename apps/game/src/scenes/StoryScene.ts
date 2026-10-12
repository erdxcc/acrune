import Phaser from 'phaser';
import { PALETTE } from '../ui/theme';
import { label, panel } from '../ui/widgets';
import { backdrop, fadeIn, go } from './common';

export interface StoryData {
  cards: readonly string[];
  next: { key: string; data?: object };
}

/** Text cards between battles; tap to turn the page. */
export class StoryScene extends Phaser.Scene {
  private story!: StoryData;
  private index = 0;
  private text!: Phaser.GameObjects.Text;

  constructor() {
    super('story');
  }

  init(data: StoryData): void {
    this.story = data;
    this.index = 0;
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.6);
    const W = this.scale.width;
    const pw = Math.min(520, W - 80);
    const px = Math.round((W - pw) / 2);
    panel(this, px, 90, pw, 150, 'parchment');
    this.text = label(this, W / 2, 165, '', 8, PALETTE.ink, [0.5, 0.5], pw - 48).setAlign('center');
    const hint = label(this, W / 2, 270, 'Tap to continue', 8, PALETTE.dim, [0.5, 0.5]);
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    this.show();
    this.input.on('pointerup', () => this.advance());
  }

  private show(): void {
    this.text.setText(this.story.cards[this.index] ?? '');
  }

  private advance(): void {
    this.index++;
    if (this.index < this.story.cards.length) this.show();
    else go(this, this.story.next.key, this.story.next.data);
  }
}
