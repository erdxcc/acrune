/**
 * Seeds demo grimoires on devnet for throwaway wallets: pnpm seed [count].
 * Drawings are synthetic copies of the templates, so every grimoire differs.
 */
import {
  BATTLES,
  DEFAULT_TEMPLATES,
  knownSpells,
  quantizeStrokes,
  scorePage,
  scribble,
  seededRandom,
  SLOPPINESS,
  SPELLS,
  type Page,
  type SpellKey,
} from '@grimoire/glyphs';
import { generateSigner } from '@metaplex-foundation/umi';
import { loadConfig } from '../src/config';
import { attributesFor, emptyProgress, recognizer } from '../src/grimoire';
import { CoreGrimoires, relayerUmi } from '../src/solana';

const config = loadConfig();
if (!config.collection) throw new Error('Run `pnpm collection` first');
const umi = relayerUmi(config.rpcUrl, config.secretKey);
const chain = new CoreGrimoires(umi, { assetSeedSecret: config.assetSeedSecret, collection: config.collection, publicBaseUrl: config.publicBaseUrl });
const random = seededRandom(Date.now() & 0xffff);
const count = Number(process.argv[2] ?? 5);

function page(spell: SpellKey): Page | null {
  const sloppiness = random() < 0.5 ? SLOPPINESS.neat : SLOPPINESS.casual;
  const strokes = SPELLS[spell].elements.map((e, i) =>
    scribble(DEFAULT_TEMPLATES.find((t) => t.glyph === e)!.points, random, sloppiness).map((p) => ({ x: p.x + i * 20, y: p.y })),
  );
  const packed = quantizeStrokes(strokes);
  const check = scorePage(recognizer, spell, packed);
  return check.ok ? { spellId: SPELLS[spell].id, accuracy: Math.floor(check.accuracy), drawMs: 400 + Math.floor(random() * 900), ...packed } : null;
}

for (let i = 0; i < count; i++) {
  const wallet = generateSigner(umi).publicKey.toString();
  const reached = 1 + Math.floor(random() * BATTLES.length);
  const cleared = BATTLES.slice(0, reached).map((b) => b.id);
  const pages = knownSpells(cleared)
    .map(page)
    .filter((p): p is Page => p !== null);
  const casts = 40 + Math.floor(random() * 120);
  const progress = {
    ...emptyProgress('demo', 'DEMO0000', Date.now()),
    cleared,
    bossDefeated: reached === BATTLES.length,
    bestTimeMs: reached === BATTLES.length ? 300_000 + Math.floor(random() * 200_000) : null,
    casts,
    precise: Math.floor(casts * (0.4 + random() * 0.5)),
    parries: Math.floor(random() * 25),
  };
  const result = await chain.write(wallet, pages, attributesFor(progress, pages), await chain.read(chain.assetFor(wallet)));
  console.log(`${i + 1}/${count} ${wallet} → ${result.status === 'error' ? result.error : `${result.status} ${'asset' in result ? result.asset : ''}`}`);
}
