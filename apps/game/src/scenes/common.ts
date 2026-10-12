import { animKey, SPRITES } from '../assets/sprites';
import { PALETTE } from '../ui/theme';

export function go(scene: Phaser.Scene, key: string, data?: object): void {
  const camera = scene.cameras.main;
  camera.fadeOut(160, 20, 16, 25);
  camera.once('camerafadeoutcomplete', () => scene.scene.start(key, data));
}

export function fadeIn(scene: Phaser.Scene): void {
  scene.cameras.main.fadeIn(160, 20, 16, 25);
}

/**
 * Scales an image to cover the box without distortion. `align` picks which part stays
 * in view vertically: 0 the top, 1 the bottom.
 */
export function cover(scene: Phaser.Scene, key: string, x: number, y: number, w: number, h: number, align = 0.5): Phaser.GameObjects.Image {
  const image = scene.add.image(0, 0, key).setOrigin(0, 0);
  const scale = Math.max(w / image.width, h / image.height);
  return image.setScale(scale).setPosition(Math.round(x + (w - image.width * scale) / 2), Math.round(y + (h - image.height * scale) * align));
}

export function backdrop(scene: Phaser.Scene, dim = 0.45): void {
  // Keeps the horizon with the castle in view; the box starts off-screen so the signpost
  // on the left of the painting does not stand behind the hero.
  cover(scene, 'bg_chapter1', -130, 0, scene.scale.width + 130, scene.scale.height, 0.43);
  if (dim > 0) scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, PALETTE.night, dim).setOrigin(0, 0);
}

/** The hero breathing in the bottom-left corner of the title screens. Text there should stay within W - 260. */
export function standingHero(scene: Phaser.Scene): Phaser.GameObjects.Sprite {
  const [ox, oy] = SPRITES.hero?.anchor ?? [0.5, 1];
  const key = animKey('hero', 'idle');
  return scene.add.sprite(84, scene.scale.height - 6, key).setOrigin(ox, oy).play(key);
}
