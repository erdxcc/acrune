import Phaser from 'phaser';
import { playMusic, unlockAudio } from './audio/sfx';
import { SCENES } from './scenes';
import { HEIGHT, PALETTE } from './ui/theme';

/** Logical height is fixed at 360 px; the width follows the screen's aspect ratio within 640-800. */
function gameWidth(): number {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return Math.round(Math.min(800, Math.max(640, HEIGHT * aspect)));
}

async function loadFont(): Promise<void> {
  try {
    const face = new FontFace('Press Start 2P', `url(${import.meta.env.BASE_URL}fonts/PressStart2P-Regular.ttf)`);
    document.fonts.add(await face.load());
  } catch (e) {
    console.warn('pixel font failed to load', e);
  }
}

window.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    playMusic(`${import.meta.env.BASE_URL}audio/music.mp3`);
  },
  { once: true },
);

await loadFont();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: gameWidth(),
  height: HEIGHT,
  backgroundColor: PALETTE.night,
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SCENES,
});
