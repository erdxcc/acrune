import { decodePages, encodePages, knownSpells, type Page, type SpellKey } from '@grimoire/glyphs';
import type { Account } from '../idos/account';

/**
 * Everything the game remembers about the player, stored in three iDos
 * userCustomData keys (or localStorage offline):
 * - progress: the relayer's signed progress token plus the cleared battles;
 * - pages: the best drawing of each spell, as the on-chain page block (base64);
 * - settings: grimoire side, volume, tutorial flag, last spell set per battle.
 */

export type GrimoireSide = 'left' | 'right';

export interface Settings {
  grimoireSide: GrimoireSide;
  volume: number;
  tutorialDone: boolean;
  /** The combination lesson at the start of battle 3 was shown. */
  comboTutorialDone?: boolean;
  sets: Partial<Record<string, SpellKey[]>>;
}

const DEFAULT_SETTINGS: Settings = { grimoireSide: 'right', volume: 0.8, tutorialDone: false, sets: {} };

export interface ProgressPayload {
  v: number;
  userId: string;
  titleId: string;
  cleared: string[];
  bossDefeated: boolean;
  bestTimeMs: number | null;
  casts: number;
  precise: number;
  parries: number;
  updatedAt: number;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Reads the payload of a relayer token (`base64url(json).signature`) without checking it. */
export function tokenPayload<T>(token: string): T | null {
  try {
    const body = token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(base64ToBytes(body + '='.repeat((4 - (body.length % 4)) % 4)));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export class Profile {
  cleared: string[] = [];
  progressToken: string | null = null;
  pages: Page[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS, sets: {} };

  constructor(private readonly account: Account) {
    const progress = parse<{ token?: string | null; cleared?: string[] }>(account.read('progress'));
    this.cleared = progress?.cleared ?? [];
    if (progress?.token) this.applyToken(progress.token);
    const pages = account.read('pages');
    if (pages) {
      try {
        this.pages = decodePages(base64ToBytes(pages));
      } catch {
        this.pages = [];
      }
    }
    this.settings = { ...DEFAULT_SETTINGS, sets: {}, ...parse<Partial<Settings>>(account.read('settings')) };
  }

  /** Spells the player knows; the grimoire's "recorded" spells. */
  get known(): SpellKey[] {
    return knownSpells(this.cleared);
  }

  get stats(): ProgressPayload | null {
    return this.progressToken ? tokenPayload<ProgressPayload>(this.progressToken) : null;
  }

  /** Takes a progress token from the relayer; its cleared battles are the verified ones. */
  applyToken(token: string): void {
    const payload = tokenPayload<ProgressPayload>(token);
    if (!payload) return;
    this.progressToken = token;
    this.cleared = [...new Set([...this.cleared, ...payload.cleared])];
  }

  markCleared(battleId: string): void {
    if (!this.cleared.includes(battleId)) this.cleared = [...this.cleared, battleId];
  }

  async saveProgress(): Promise<void> {
    await this.account.write('progress', JSON.stringify({ token: this.progressToken, cleared: this.cleared }));
  }

  async savePages(pages: Page[]): Promise<void> {
    this.pages = pages;
    await this.account.write('pages', bytesToBase64(encodePages(pages)));
  }

  async saveSettings(): Promise<void> {
    await this.account.write('settings', JSON.stringify(this.settings));
  }
}
