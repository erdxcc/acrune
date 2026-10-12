import { decodePages, spellById, type Page } from '@grimoire/glyphs';
import Phaser from 'phaser';
import { app } from '../app';
import { explorerAddress, shortAddress } from '../config';
import { SPELL_DEFS } from '../content';
import { syncGrimoire } from '../state/runs';
import { base64ToBytes } from '../state/profile';
import { drawPage } from '../ui/glyphs';
import { PALETTE } from '../ui/theme';
import { Button, label, openLink, panel } from '../ui/widgets';
import { backdrop, fadeIn, go } from './common';

/** "Grimoire on Solana": wallet status, the asset, its attributes and its pages as stored on-chain. */
export class SolanaScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private dynamic: { destroy(): void }[] = [];

  constructor() {
    super('solana');
  }

  create(): void {
    fadeIn(this);
    backdrop(this, 0.65);
    const W = this.scale.width;
    this.dynamic = [];
    label(this, W / 2, 16, 'GRIMOIRE ON SOLANA', 16, PALETTE.gold, [0.5, 0]);
    label(this, W / 2, 38, 'Devnet. Soulbound: it stays with your wallet.', 8, PALETTE.dim, [0.5, 0]);
    panel(this, 12, 56, Math.round(W * 0.4), 260);
    this.status = label(this, 24, 68, '', 8, PALETTE.text, [0, 0], Math.round(W * 0.4) - 24);
    new Button(this, 70, 338, 'Back', () => go(this, 'menu'), { width: 100, tone: 'quiet' });
    void this.refresh();
  }

  private clear(): void {
    for (const o of this.dynamic) o.destroy();
    this.dynamic = [];
  }

  private button(caption: string, y: number, onPress: () => void): Button {
    const b = new Button(this, 12 + Math.round(this.scale.width * 0.2), y, caption, onPress, { width: Math.round(this.scale.width * 0.36) });
    this.dynamic.push(b);
    return b;
  }

  private async refresh(): Promise<void> {
    this.clear();
    const { account, relayer, profile } = app();
    if (account.mode === 'offline') {
      this.status.setText('Offline mode. Your pages stay on this device. Run the game on iDos to keep them on Solana.');
      this.pages(profile.pages, 'ON THIS DEVICE');
      return;
    }
    this.status.setText('Reading your grimoire...');
    const wallet = await account.linkedWallet(true).catch(() => null);
    if (!wallet) {
      this.status.setText('No Solana wallet linked yet.\n\nLink one and your grimoire is written on-chain with every page you have drawn. You sign nothing else and pay nothing.');
      this.button('Link Solana wallet', 280, () => void this.link());
      this.pages(profile.pages, 'ON THIS DEVICE');
      return;
    }
    if (!relayer.enabled) {
      this.status.setText(`Wallet ${shortAddress(wallet)}\n\nThe grimoire relayer is not configured for this build.`);
      this.pages(profile.pages, 'ON THIS DEVICE');
      return;
    }
    try {
      const view = await relayer.grimoire(wallet);
      if (!view.exists) {
        this.status.setText(`Wallet ${shortAddress(wallet)}\n\nNo grimoire on-chain yet. It is written after a victory, or now.`);
        this.button('Write it now', 280, () => void this.sync());
        this.pages(profile.pages, 'ON THIS DEVICE');
        return;
      }
      const lines = Object.entries(view.attributes).map(([k, v]) => `${k}: ${v}`);
      this.status.setText([`Wallet ${shortAddress(wallet)}`, `Grimoire ${shortAddress(view.asset)}`, '', ...lines].join('\n'));
      this.button('View on Solana Explorer', 280, () => openLink(explorerAddress(view.asset)));
      this.pages(view.pages ? decodePages(base64ToBytes(view.pages)) : [], 'ON-CHAIN PAGES');
    } catch (e) {
      this.status.setText(`Could not read the grimoire: ${e instanceof Error ? e.message : String(e)}`);
      this.pages(profile.pages, 'ON THIS DEVICE');
    }
  }

  private async link(): Promise<void> {
    this.status.setText('Linking wallet...');
    const result = await app().account.linkWallet();
    if (!result.ok) {
      this.status.setText(`Could not link the wallet: ${result.error}`);
      return;
    }
    await this.sync();
  }

  private async sync(): Promise<void> {
    this.clear();
    this.status.setText('Writing your grimoire on Solana...');
    const write = await syncGrimoire();
    if (write.status === 'error') {
      this.status.setText(`The grimoire was not written: ${write.error}`);
      return;
    }
    await this.refresh();
  }

  /** The pages as drawn by the player, each with its spell and accuracy. */
  private pages(pages: Page[], title: string): void {
    const W = this.scale.width;
    const x0 = Math.round(W * 0.4) + 28;
    const areaW = W - x0 - 12;
    this.dynamic.push(label(this, x0, 60, title, 8, PALETTE.dim));
    if (pages.length === 0) {
      this.dynamic.push(label(this, x0, 80, 'No pages yet. Cast spells to fill them.', 8, PALETTE.text, [0, 0], areaW));
      return;
    }
    const cell = 80;
    const columns = Math.max(1, Math.floor(areaW / cell));
    const g = this.add.graphics();
    this.dynamic.push(g);
    pages.forEach((page, i) => {
      const x = x0 + (i % columns) * cell;
      const y = 76 + Math.floor(i / columns) * (cell + 16);
      g.fillStyle(PALETTE.parchment, 1).fillRect(x, y, cell - 8, cell - 8);
      g.lineStyle(2, PALETTE.parchmentLine, 1).strokeRect(x + 1, y + 1, cell - 10, cell - 10);
      drawPage(g, page, x + (cell - 8) / 2, y + (cell - 8) / 2, cell - 24, 2);
      const key = spellById(page.spellId)?.key;
      this.dynamic.push(label(this, x, y + cell - 4, `${key ? SPELL_DEFS[key].name : '?'} ${page.accuracy}%`, 8, PALETTE.text));
    });
  }
}
