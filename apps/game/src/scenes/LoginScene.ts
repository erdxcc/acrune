import Phaser from 'phaser';
import { startApp } from '../app';
import { setVolume } from '../audio/sfx';
import { GAME_TITLE } from '../content/story';
import { OfflineAccount, type Account, type Outcome } from '../idos/account';
import { IdosAccount } from '../idos/idosAccount';
import { detectTitleId } from '../idos/title';
import { PALETTE } from '../ui/theme';
import { Button, label } from '../ui/widgets';
import { backdrop, fadeIn, go, standingHero } from './common';

export class LoginScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private buttons: Button[] = [];

  constructor() {
    super('login');
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.35);
    standingHero(this);
    const W = this.scale.width;
    label(this, W / 2, 70, GAME_TITLE.toUpperCase(), 32, PALETTE.gold, [0.5, 0.5]);
    label(this, W / 2, 106, 'Draw the glyphs. Bind the elements.', 8, PALETTE.text, [0.5, 0.5]);
    this.status = label(this, W / 2, 300, '', 8, PALETTE.dim, [0.5, 0.5], W - 260).setAlign('center');
    this.buttons = [];

    const titleId = detectTitleId();
    if (!titleId) {
      this.buttons.push(new Button(this, W / 2, 180, 'Play offline', () => this.enter(new OfflineAccount()), { tone: 'primary', width: 260 }));
      this.status.setText('No iDos title configured: saves stay on this device and Solana is off.');
      return;
    }

    const account = new IdosAccount(titleId);
    this.buttons.push(
      new Button(this, W / 2, 170, 'Play as guest', () => this.attempt(account, () => account.signInAsGuest()), { tone: 'primary', width: 260 }),
      new Button(this, W / 2, 212, 'Sign in with Solana wallet', () => this.attempt(account, () => account.signInWithWallet()), { width: 260 }),
    );
    this.status.setText('Guests can link a wallet later and keep their grimoire.');
    if (account.hasRememberedSession()) {
      this.busy('Signing in...');
      void account.resume().then((ok) => (ok ? this.enter(account) : this.idle('Sign in to continue.')));
    }
  }

  private async attempt(account: IdosAccount, signIn: () => Promise<Outcome>): Promise<void> {
    this.busy('Signing in...');
    const result = await signIn();
    if (result.ok) this.enter(account);
    else this.idle(`Could not sign in: ${result.error}`);
  }

  private enter(account: Account): void {
    const { profile } = startApp(account);
    setVolume(profile.settings.volume);
    go(this, 'menu');
  }

  private busy(message: string): void {
    this.status.setText(message);
    for (const b of this.buttons) b.setEnabled(false);
  }

  private idle(message: string): void {
    this.status.setText(message);
    for (const b of this.buttons) b.setEnabled(true);
  }
}
