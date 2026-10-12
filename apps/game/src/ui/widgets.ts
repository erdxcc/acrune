import { sfx } from '../audio/sfx';
import { PALETTE, textStyle } from './theme';

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 8,
  color: number = PALETTE.text,
  origin: [number, number] = [0, 0],
  wrap?: number,
): Phaser.GameObjects.Text {
  return scene.add.text(Math.round(x), Math.round(y), text, textStyle(size, color, wrap)).setOrigin(origin[0], origin[1]);
}

export interface ButtonOptions {
  width?: number;
  height?: number;
  size?: number;
  tone?: 'primary' | 'plain' | 'quiet';
}

/** A pixel button: a framed rectangle with a label, pressed on pointer up. */
export class Button {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly text: Phaser.GameObjects.Text;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    caption: string,
    private readonly onPress: () => void,
    options: ButtonOptions = {},
  ) {
    const size = options.size ?? 8;
    const width = options.width ?? Math.max(120, caption.length * size + 24);
    const height = options.height ?? size + 16;
    const tone = options.tone ?? 'plain';
    const fill = tone === 'primary' ? PALETTE.gold : tone === 'quiet' ? PALETTE.ink : PALETTE.inkLight;
    const color = tone === 'primary' ? PALETTE.ink : PALETTE.text;
    this.bg = scene.add
      .rectangle(Math.round(x), Math.round(y), width, height, fill)
      .setStrokeStyle(2, tone === 'primary' ? PALETTE.text : PALETTE.dim)
      .setInteractive({ useHandCursor: true });
    this.text = label(scene, x, y, caption, size, color, [0.5, 0.5]);
    this.bg.on('pointerover', () => this.enabled && this.bg.setStrokeStyle(2, PALETTE.text));
    this.bg.on('pointerout', () => this.bg.setStrokeStyle(2, tone === 'primary' ? PALETTE.text : PALETTE.dim));
    this.bg.on('pointerdown', () => this.enabled && this.text.setY(Math.round(y) + 1));
    this.bg.on('pointerup', () => {
      this.text.setY(Math.round(y));
      if (!this.enabled) return;
      sfx('click');
      this.onPress();
    });
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.bg.setAlpha(enabled ? 1 : 0.4);
    this.text.setAlpha(enabled ? 1 : 0.5);
    return this;
  }

  setCaption(caption: string): this {
    this.text.setText(caption);
    return this;
  }

  setVisible(visible: boolean): this {
    this.bg.setVisible(visible);
    this.text.setVisible(visible);
    return this;
  }

  destroy(): void {
    this.bg.destroy();
    this.text.destroy();
  }
}

/** Framed panel; parchment for grimoire pages, ink for overlays. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  kind: 'ink' | 'parchment' = 'ink',
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const fill = kind === 'ink' ? PALETTE.ink : PALETTE.parchment;
  const border = kind === 'ink' ? PALETTE.dim : PALETTE.parchmentLine;
  g.fillStyle(0x000000, 0.35).fillRect(x + 3, y + 3, width, height);
  g.fillStyle(fill, 1).fillRect(x, y, width, height);
  g.lineStyle(2, border, 1).strokeRect(x + 1, y + 1, width - 2, height - 2);
  return g;
}

/** Opens a link from a button press (popups opened outside a gesture get blocked). */
export function openLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
