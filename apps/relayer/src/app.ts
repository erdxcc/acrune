import { createHash } from 'node:crypto';
import { battleById, decodePages, encodePages, type Page } from '@grimoire/glyphs';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { COLLECTION_NAME, grimoireName, SYMBOL } from './brand';
import type { Config } from './config';
import { acceptPages, applyWin, attributesFor, emptyProgress, mergePages, type Attribute } from './grimoire';
import type { IdosApi, IdosSession } from './idos';
import { RateLimit } from './ratelimit';
import { renderGrimoire } from './render';
import { signToken, verifyToken, type ProgressClaims } from './tokens';

export type GrimoireWrite =
  | { status: 'written' | 'pending'; asset: string; signatures: string[] }
  | { status: 'unchanged'; asset: string }
  | { status: 'no-wallet' }
  | { status: 'error'; error: string };

export interface GrimoireState {
  asset: string;
  exists: boolean;
  owner: string | null;
  pages: Page[];
  attributes: Attribute[];
}

/** What the routes need from Solana; solana.ts implements it with Metaplex Core. */
export interface GrimoireChain {
  assetFor(wallet: string): string;
  read(asset: string): Promise<GrimoireState>;
  write(wallet: string, pages: Page[], attributes: Attribute[], current: GrimoireState): Promise<GrimoireWrite>;
  health(): Promise<{ relayer: string; balanceSol: number; collection: string | null }>;
}

export interface Deps {
  config: Config;
  idos: IdosApi;
  chain: GrimoireChain | null;
  now?: () => number;
}

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const session = { titleId: z.string().max(32), userId: z.string().max(128), ticket: z.string().max(4096) };
const startBody = z.object({ ...session, battleId: z.string().max(32) });
const finishBody = z.object({
  ...session,
  runToken: z.string().max(4096),
  progressToken: z.string().max(4096).nullish(),
  result: z.enum(['win', 'loss']),
  stats: z.object({ durationMs: z.number().nonnegative(), casts: z.number(), precise: z.number(), parries: z.number() }),
  pages: z.string().max(2000).nullish(),
});
const syncBody = z.object({ ...session, progressToken: z.string().max(4096), pages: z.string().max(2000).nullish() });

export function allowedOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'idos.games' ||
      hostname.endsWith('.idos.games') ||
      hostname === 'idosgames.com' ||
      hostname.endsWith('.idosgames.com')
    );
  } catch {
    return false;
  }
}

function pagesFrom(text: string | null | undefined): Page[] {
  if (!text) return [];
  try {
    return decodePages(new Uint8Array(Buffer.from(text, 'base64')));
  } catch {
    return [];
  }
}

export function createApp(deps: Deps): Hono {
  const { config, idos, chain } = deps;
  const now = deps.now ?? Date.now;
  const writes = new RateLimit(30, 60 * 60 * 1000);
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigin(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type'],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  }

  /** Null when the session is good; otherwise the error response. */
  async function authorize(c: Context, s: IdosSession): Promise<Response | null> {
    if (config.allowedTitles.length > 0 && !config.allowedTitles.includes(s.titleId)) {
      return c.json({ error: 'this title is not served here' }, 403);
    }
    const verdict = await idos.verify(s);
    if (verdict === 'invalid') return c.json({ error: 'the iDos session was rejected' }, 401);
    if (verdict === 'unavailable') return c.json({ error: 'iDos is unavailable, try again' }, 503);
    return null;
  }

  function progressOf(token: string | null | undefined, s: IdosSession): ProgressClaims | null {
    const claims = token ? verifyToken(token, 'progress', config.tokenSecret) : null;
    return claims && claims.userId === s.userId && claims.titleId === s.titleId ? claims : null;
  }

  async function writeGrimoire(s: IdosSession, progress: ProgressClaims, pages: Page[]): Promise<GrimoireWrite> {
    if (!chain) return { status: 'error', error: 'Solana writes are not configured' };
    const linked = await idos.linkedSolanaWallet(s);
    if (linked.status !== 'ok') return { status: 'error', error: 'could not read the linked wallet' };
    if (!linked.wallet) return { status: 'no-wallet' };
    if (!writes.take(`${s.titleId}/${s.userId}`, now())) return { status: 'error', error: 'too many writes, try again later' };
    const current = await chain.read(chain.assetFor(linked.wallet));
    const merged = mergePages(current.pages, pages);
    return chain.write(linked.wallet, merged, attributesFor(progress, merged), current);
  }

  app.get('/health', async (c) => c.json({ ok: true, cluster: 'devnet', chain: chain ? await chain.health() : null }));

  app.post('/v1/run/start', async (c) => {
    const s = await body(c, startBody);
    if (!s || !battleById(s.battleId)) return c.json({ error: 'bad request' }, 400);
    const denied = await authorize(c, s);
    if (denied) return denied;
    const runToken = signToken({ v: 1, kind: 'run', userId: s.userId, titleId: s.titleId, battleId: s.battleId, startedAt: now() }, config.tokenSecret);
    return c.json({ runToken });
  });

  app.post('/v1/run/finish', async (c) => {
    const s = await body(c, finishBody);
    if (!s) return c.json({ error: 'bad request' }, 400);
    const denied = await authorize(c, s);
    if (denied) return denied;
    const run = verifyToken(s.runToken, 'run', config.tokenSecret);
    if (!run || run.userId !== s.userId || run.titleId !== s.titleId) return c.json({ error: 'invalid run token' }, 400);

    let progress = progressOf(s.progressToken, s) ?? emptyProgress(s.userId, s.titleId, now());
    let counted = false;
    let reason: string | undefined;
    if (s.result === 'win') {
      const win = applyWin(progress, run, s.stats, now());
      progress = win.progress;
      counted = win.counted;
      if (!win.counted) reason = win.reason;
    }
    const { accepted } = acceptPages(pagesFrom(s.pages), progress.cleared);
    const grimoire: GrimoireWrite = counted
      ? await writeGrimoire(s, progress, accepted)
      : { status: 'error', error: reason ?? 'only wins are written' };
    return c.json({ progressToken: signToken(progress, config.tokenSecret), counted, reason, grimoire });
  });

  app.post('/v1/grimoire/sync', async (c) => {
    const s = await body(c, syncBody);
    if (!s) return c.json({ error: 'bad request' }, 400);
    const denied = await authorize(c, s);
    if (denied) return denied;
    const progress = progressOf(s.progressToken, s);
    if (!progress) return c.json({ error: 'invalid progress token' }, 400);
    if (progress.cleared.length === 0) return c.json({ grimoire: { status: 'error', error: 'win a battle first' } });
    const { accepted } = acceptPages(pagesFrom(s.pages), progress.cleared);
    return c.json({ grimoire: await writeGrimoire(s, progress, accepted) });
  });

  app.get('/v1/grimoire/:wallet', async (c) => {
    if (!chain) return c.json({ error: 'Solana is not configured' }, 503);
    const wallet = c.req.param('wallet');
    if (!ADDRESS_RE.test(wallet)) return c.json({ error: 'bad wallet address' }, 400);
    const asset = chain.assetFor(wallet);
    const state = await chain.read(asset);
    return c.json({
      wallet,
      asset,
      exists: state.exists,
      pages: state.pages.length > 0 ? Buffer.from(encodePages(state.pages)).toString('base64') : null,
      attributes: Object.fromEntries(state.attributes.map((a) => [a.key, a.value])),
      image: `${config.publicBaseUrl}/img/${asset}.png`,
    });
  });

  app.get('/meta/collection.json', (c) =>
    c.json({
      name: COLLECTION_NAME,
      symbol: SYMBOL,
      description: 'Soulbound grimoires of Acrune players. Each one holds the glyphs its owner drew in battle.',
      image: `${config.publicBaseUrl}/img/collection.png`,
      external_url: config.gameUrl,
    }),
  );

  app.get('/img/collection.png', (c) => c.body(new Uint8Array(renderGrimoire([])), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }));

  app.get('/meta/:file', async (c) => {
    const asset = c.req.param('file').replace(/\.json$/, '');
    if (!chain || !ADDRESS_RE.test(asset)) return c.json({ error: 'not found' }, 404);
    const state = await chain.read(asset);
    if (!state.exists) return c.json({ error: 'not found' }, 404);
    const version = createHash('sha256').update(encodePages(state.pages)).update(JSON.stringify(state.attributes)).digest('hex').slice(0, 12);
    const image = `${config.publicBaseUrl}/img/${asset}.png?v=${version}`;
    c.header('cache-control', 'public, max-age=60');
    return c.json({
      name: state.owner ? grimoireName(state.owner) : 'Grimoire',
      symbol: SYMBOL,
      description:
        'A soulbound Acrune grimoire. Every page holds a glyph drawn by its owner in battle, checked by the game server and kept on Solana.',
      image,
      external_url: config.gameUrl,
      attributes: state.attributes.map((a) => ({ trait_type: a.key, value: a.value })),
      properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
    });
  });

  app.get('/img/:file', async (c) => {
    const asset = c.req.param('file').replace(/\.png$/, '');
    if (!chain || !ADDRESS_RE.test(asset)) return c.json({ error: 'not found' }, 404);
    const state = await chain.read(asset);
    const png = renderGrimoire(state.pages);
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' });
  });

  return app;
}
