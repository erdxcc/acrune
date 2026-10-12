import { app } from '../app';
import { setVolume } from '../audio/sfx';
import { PALETTE } from './theme';
import { Button, label, panel } from './widgets';

/** Settings overlay: grimoire side and sound. Saved when closed. */
export function openSettings(scene: Phaser.Scene, onClose: () => void, note?: string): void {
  const { profile } = app();
  const W = scene.scale.width;
  const H = scene.scale.height;
  const objects: { destroy(): void }[] = [];
  const add = <T extends { destroy(): void }>(o: T): T => {
    objects.push(o);
    return o;
  };

  add(scene.add.rectangle(0, 0, W, H, PALETTE.night, 0.7).setOrigin(0, 0).setInteractive().setDepth(500));
  const pw = 320;
  const ph = note ? 180 : 160;
  const px = Math.round((W - pw) / 2);
  const py = Math.round((H - ph) / 2);
  add(panel(scene, px, py, pw, ph).setDepth(501));
  add(label(scene, W / 2, py + 14, 'SETTINGS', 16, PALETTE.gold, [0.5, 0]).setDepth(502));

  const sideText = () => `Grimoire: ${profile.settings.grimoireSide === 'right' ? 'RIGHT' : 'LEFT'}`;
  const side = add(
    new Button(scene, W / 2, py + 56, sideText(), () => {
      profile.settings.grimoireSide = profile.settings.grimoireSide === 'right' ? 'left' : 'right';
      side.setCaption(sideText());
    }, { width: 240 }),
  );
  side.bg.setDepth(502);
  side.text.setDepth(503);

  const volumeText = add(label(scene, W / 2, py + 92, '', 8, PALETTE.text, [0.5, 0.5]).setDepth(502));
  const showVolume = () => volumeText.setText(`Sound ${Math.round(profile.settings.volume * 100)}%`);
  showVolume();
  const step = (delta: number) => {
    profile.settings.volume = Math.round(Math.max(0, Math.min(1, profile.settings.volume + delta)) * 10) / 10;
    setVolume(profile.settings.volume);
    showVolume();
  };
  for (const [dx, caption, delta] of [[-100, '-', -0.1], [100, '+', 0.1]] as const) {
    const b = add(new Button(scene, W / 2 + dx, py + 92, caption, () => step(delta), { width: 32 }));
    b.bg.setDepth(502);
    b.text.setDepth(503);
  }
  if (note) add(label(scene, W / 2, py + 116, note, 8, PALETTE.dim, [0.5, 0]).setDepth(502));

  const close = add(
    new Button(scene, W / 2, py + ph - 24, 'Close', () => {
      void profile.saveSettings();
      for (const o of objects) o.destroy();
      onClose();
    }, { tone: 'primary' }),
  );
  close.bg.setDepth(502);
  close.text.setDepth(503);
}
