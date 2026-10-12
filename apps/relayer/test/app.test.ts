import {
  DEFAULT_TEMPLATES,
  encodePages,
  quantizeStrokes,
  scribble,
  seededRandom,
  SLOPPINESS,
  SPELLS,
  type Page,
} from '@grimoire/glyphs';
import { describe, expect, it } from 'vitest';
import { createApp, type GrimoireChain, type GrimoireState } from '../src/app';
import type { Config } from '../src/config';
import { IdosApi, pickSolanaWallet } from '../src/idos';
import { verifyToken } from '../src/tokens';

const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const config: Config = {
  rpcUrl: 'http://localhost',
  secretKey: null,
  assetSeedSecret: 'seed-secret-seed-secret',
  tokenSecret: 'token-secret-token-secret',
  collection: 'Grim1111111111111111111111111111111111111111',
  publicBaseUrl: 'https://relayer.test',
  gameUrl: 'https://game.test',
  idosApiBase: 'https://idos.test',
  allowedTitles: ['ABCD1234'],
};
const session = { titleId: 'ABCD1234', userId: 'user-0001', ticket: 'ticket-0123456789abcdef' };

/** iDos stand-in: accepts `session`, reports `wallet` as linked. */
function fakeIdos(wallet: string | null) {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${session.ticket}` || !url.endsWith(`/${session.userId}`)) return new Response('{}', { status: 401 });
    const data = url.includes('Blockchain/GetUserState')
      ? { State: { LinkedWallets: wallet ? { solana: { Address: wallet, IsSignatureVerified: true } } : {} } }
      : { UsageTime: 1 };
    return new Response(JSON.stringify({ Success: true, Data: data }), { status: 200 });
  }) as typeof fetch;
  return new IdosApi(config.idosApiBase, fetchImpl);
}

/** In-memory chain. */
function fakeChain(): GrimoireChain & { states: Map<string, GrimoireState> } {
  const states = new Map<string, GrimoireState>();
  return {
    states,
    assetFor: (wallet) => `Asset${wallet.slice(5)}`,
    read: async (asset) => states.get(asset) ?? { asset, exists: false, owner: null, pages: [], attributes: [] },
    write: async (wallet, pages, attributes, current) => {
      const asset = `Asset${wallet.slice(5)}`;
      if (current.exists && JSON.stringify(current.pages) === JSON.stringify(pages) && JSON.stringify(current.attributes) === JSON.stringify(attributes)) {
        return { status: 'unchanged', asset };
      }
      states.set(asset, { asset, exists: true, owner: wallet, pages, attributes });
      return { status: 'written', asset, signatures: ['sig'] };
    },
    health: async () => ({ relayer: 'Relayer', balanceSol: 1, collection: config.collection }),
  };
}

function fireDrawing(): Page {
  const stroke = scribble(DEFAULT_TEMPLATES.find((t) => t.glyph === 'fire')!.points, seededRandom(4), SLOPPINESS.neat);
  return { spellId: SPELLS.fire.id, accuracy: 100, drawMs: 400, ...quantizeStrokes([stroke]) };
}

function setup(wallet: string | null = WALLET) {
  let clock = 1_000_000;
  const chain = fakeChain();
  const app = createApp({ config, idos: fakeIdos(wallet), chain, now: () => clock });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://abcd1234.idos.games' }, body: JSON.stringify(body) });
  return { app, chain, post, advance: (ms: number) => (clock += ms) };
}

describe('relayer routes', () => {
  it('runs a battle end to end and writes the grimoire', async () => {
    const { post, chain, advance, app } = setup();
    const start = await post('/v1/run/start', { ...session, battleId: 'c1-b1' });
    expect(start.status).toBe(200);
    expect(start.headers.get('access-control-allow-origin')).toBe('https://abcd1234.idos.games');
    const { runToken } = (await start.json()) as { runToken: string };
    advance(45_000);
    const pages = Buffer.from(encodePages([fireDrawing()])).toString('base64');
    const finish = await post('/v1/run/finish', { ...session, runToken, progressToken: null, result: 'win', stats: { durationMs: 45_000, casts: 12, precise: 9, parries: 0 }, pages });
    const body = (await finish.json()) as { progressToken: string; counted: boolean; grimoire: { status: string; asset: string } };
    expect(body.counted).toBe(true);
    expect(body.grimoire.status).toBe('written');
    expect(verifyToken(body.progressToken, 'progress', config.tokenSecret)?.cleared).toEqual(['c1-b1']);
    const stored = chain.states.get(body.grimoire.asset)!;
    expect(stored.pages).toHaveLength(1);
    expect(stored.attributes.find((a) => a.key === 'Spells')?.value).toBe('1');

    const view = await app.request(`/v1/grimoire/${WALLET}`);
    expect(await view.json()).toMatchObject({ exists: true, attributes: { 'Chapter 1': 'In progress' } });
    const meta = await app.request(`/meta/${body.grimoire.asset}.json`);
    expect(meta.status).toBe(200);
    const image = await app.request(`/img/${body.grimoire.asset}.png`);
    expect(image.headers.get('content-type')).toBe('image/png');
  });

  it('refuses bad tickets, foreign titles and forged run tokens', async () => {
    const { post } = setup();
    expect((await post('/v1/run/start', { ...session, ticket: 'wrong-ticket-0123456789', battleId: 'c1-b1' })).status).toBe(401);
    expect((await post('/v1/run/start', { ...session, titleId: 'ZZZZ9999', battleId: 'c1-b1' })).status).toBe(403);
    expect((await post('/v1/run/start', { ...session, battleId: 'nope' })).status).toBe(400);
    const finish = await post('/v1/run/finish', { ...session, runToken: 'abc.def', result: 'win', stats: { durationMs: 1, casts: 0, precise: 0, parries: 0 } });
    expect(finish.status).toBe(400);
  });

  it('does not count a win that came too fast', async () => {
    const { post, advance } = setup();
    const { runToken } = (await (await post('/v1/run/start', { ...session, battleId: 'c1-b1' })).json()) as { runToken: string };
    advance(3_000);
    const body = (await (await post('/v1/run/finish', { ...session, runToken, result: 'win', stats: { durationMs: 3_000, casts: 2, precise: 1, parries: 0 } })).json()) as {
      counted: boolean;
      grimoire: { status: string };
    };
    expect(body.counted).toBe(false);
    expect(body.grimoire.status).toBe('error');
  });

  it('tells guests to link a wallet, then syncs once they do', async () => {
    const guest = setup(null);
    const { runToken } = (await (await guest.post('/v1/run/start', { ...session, battleId: 'c1-b1' })).json()) as { runToken: string };
    guest.advance(40_000);
    const pages = Buffer.from(encodePages([fireDrawing()])).toString('base64');
    const finish = (await (await guest.post('/v1/run/finish', { ...session, runToken, result: 'win', stats: { durationMs: 40_000, casts: 8, precise: 4, parries: 0 }, pages })).json()) as {
      progressToken: string;
      grimoire: { status: string };
    };
    expect(finish.grimoire.status).toBe('no-wallet');

    const linked = setup(WALLET);
    const sync = (await (await linked.post('/v1/grimoire/sync', { ...session, progressToken: finish.progressToken, pages })).json()) as { grimoire: { status: string } };
    expect(sync.grimoire.status).toBe('written');
    const again = (await (await linked.post('/v1/grimoire/sync', { ...session, progressToken: finish.progressToken, pages })).json()) as { grimoire: { status: string } };
    expect(again.grimoire.status).toBe('unchanged');
  });
});

describe('pickSolanaWallet', () => {
  it('takes only signature-verified Solana addresses', () => {
    expect(pickSolanaWallet({ State: { LinkedWallets: { polygon: { Address: '0xabc', IsSignatureVerified: true } } } })).toBeNull();
    expect(pickSolanaWallet({ State: { LinkedWallets: { sol: { Address: WALLET, IsSignatureVerified: false } } } })).toBeNull();
    expect(pickSolanaWallet({ LinkedWallets: { sol: { Address: WALLET, IsSignatureVerified: true } } })).toBe(WALLET);
  });
});
