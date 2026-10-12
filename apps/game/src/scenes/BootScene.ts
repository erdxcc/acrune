import Phaser from 'phaser';
import { buildSprites, queueSpriteFiles } from '../assets/sprites';
import { PALETTE } from '../ui/theme';
import { label } from '../ui/widgets';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    label(this, this.scale.width / 2, this.scale.height / 2, 'Loading...', 8, PALETTE.dim, [0.5, 0.5]);
    queueSpriteFiles(this.load);
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn(`asset ${file.key} failed, using a placeholder`));
  }

  create(): void {
    buildSprites(this);
    this.scene.start('login');
  }
}
