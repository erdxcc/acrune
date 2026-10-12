import { BATTLES, chapterCleared, nextBattle } from '@grimoire/glyphs';
import Phaser from 'phaser';
import { app } from '../app';
import { shortAddress } from '../config';
import { GAME_TITLE, INTRO_CARDS } from '../content/story';
import { openSettings } from '../ui/settingsPanel';
import { PALETTE } from '../ui/theme';
import { Button, label } from '../ui/widgets';
import { backdrop, fadeIn, go, standingHero } from './common';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.35);
    standingHero(this);
    const { profile, account } = app();
    const W = this.scale.width;
    label(this, W / 2, 64, GAME_TITLE.toUpperCase(), 32, PALETTE.gold, [0.5, 0.5]);
    label(this, W / 2, 98, 'Chapter 1: The Sundered Gate', 8, PALETTE.text, [0.5, 0.5]);

    const done = chapterCleared(profile.cleared);
    const caption = profile.cleared.length === 0 ? 'Play' : done ? 'Replay chapter' : 'Continue';
    new Button(this, W / 2, 150, caption, () => this.play(), { tone: 'primary', width: 240 });
    new Button(this, W / 2, 190, 'Grimoire on Solana', () => go(this, 'solana'), { width: 240 });
    new Button(this, W / 2, 230, 'Settings', () => openSettings(this, () => undefined), { width: 240 });

    const footer = label(this, W / 2, 300, '', 8, PALETTE.dim, [0.5, 0.5], W - 260).setAlign('center');
    if (account.mode === 'offline') {
      footer.setText('Offline mode: saves stay on this device.');
    } else {
      footer.setText('Checking wallet...');
      void account
        .linkedWallet()
        .then((wallet) =>
          footer.setText(wallet ? `Wallet ${shortAddress(wallet)}` : 'Guest. Link a wallet to keep your grimoire on Solana.'),
        )
        .catch(() => footer.setText('Signed in.'));
      new Button(this, W - 52, 340, 'Sign out', () => {
        account.signOut();
        go(this, 'login');
      }, { width: 88, tone: 'quiet' });
    }
  }

  private play(): void {
    const { profile } = app();
    if (profile.cleared.length === 0) {
      go(this, 'story', { cards: INTRO_CARDS, next: { key: 'prep', data: { battleId: BATTLES[0]!.id } } });
      return;
    }
    const battle = nextBattle(profile.cleared) ?? BATTLES[0]!;
    go(this, 'prep', { battleId: battle.id });
  }
}
