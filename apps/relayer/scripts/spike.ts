/**
 * Spike B on devnet: create a grimoire for a throwaway wallet, write pages,
 * update attributes on the frozen asset, read everything back, and confirm the
 * owner cannot transfer it (soulbound).
 */
import {
  DEFAULT_TEMPLATES,
  encodePages,
  quantizeStrokes,
  scorePage,
  scribble,
  seededRandom,
  SLOPPINESS,
  SPELLS,
  type Element,
  type Page,
  type SpellKey,
} from '@grimoire/glyphs';
import { burn, fetchAssetV1, fetchCollectionV1, transfer } from '@metaplex-foundation/mpl-core';
import { generateSigner, publicKey } from '@metaplex-foundation/umi';
import { loadConfig } from '../src/config';
import { attributesFor, emptyProgress, recognizer } from '../src/grimoire';
import { CoreGrimoires, relayerUmi, sendTx } from '../src/solana';

const config = loadConfig();
if (!config.collection) throw new Error('Run `pnpm collection` first');
const umi = relayerUmi(config.rpcUrl, config.secretKey);
const chain = new CoreGrimoires(umi, { assetSeedSecret: config.assetSeedSecret, collection: config.collection, publicBaseUrl: config.publicBaseUrl });
const random = seededRandom(Date.now() & 0xffff);

function page(spell: SpellKey): Page {
  const strokes = SPELLS[spell].elements.map((e: Element, i) =>
    scribble(DEFAULT_TEMPLATES.find((t) => t.glyph === e)!.points, random, SLOPPINESS.neat).map((p) => ({ x: p.x + i * 20, y: p.y })),
  );
  const packed = quantizeStrokes(strokes);
  const check = scorePage(recognizer, spell, packed);
  if (!check.ok) throw new Error(`synthetic ${spell} drawing rejected: ${check.reason}`);
  return { spellId: SPELLS[spell].id, accuracy: Math.floor(check.accuracy), drawMs: 600, ...packed };
}

const owner = generateSigner(umi);
const wallet = owner.publicKey.toString();
const asset = chain.assetFor(wallet);
console.log(`owner ${wallet}\nasset ${asset}`);

const progress = { ...emptyProgress('spike-user', 'SPIKE000', Date.now()), cleared: ['c1-b1', 'c1-b2'], casts: 20, precise: 15, parries: 2 };
const firstPages = [page('fire'), page('water')];
console.log(`page block ${encodePages(firstPages).length} bytes`);
let result = await chain.write(wallet, firstPages, attributesFor(progress, firstPages), await chain.read(asset));
console.log('create:', result);

let state = await chain.read(asset);
console.log(`read: exists=${state.exists} owner=${state.owner} pages=${state.pages.map((p) => `${p.spellId}:${p.accuracy}`).join(',')}`);
console.log('attributes:', state.attributes.map((a) => `${a.key}=${a.value}`).join(', '));

const more = [...state.pages, page('steam'), page('air')];
const later = { ...progress, cleared: ['c1-b1', 'c1-b2', 'c1-b3'], casts: 40, precise: 33, parries: 5 };
result = await chain.write(wallet, more, attributesFor(later, more), state);
console.log('update:', result);
state = await chain.read(asset);
console.log(`read: pages=${state.pages.map((p) => `${p.spellId}:${p.accuracy}`).join(',')} (${encodePages(state.pages).length} bytes)`);
console.log('attributes:', state.attributes.map((a) => `${a.key}=${a.value}`).join(', '));

const unchanged = await chain.write(wallet, state.pages, state.attributes, state);
console.log('rewrite same data:', unchanged.status);

// Soulbound check: the owner signs a transfer and a burn, the relayer pays. Both must fail,
// and the program log must show that the freeze plugin rejected them.
function refusal(e: unknown): string {
  const message = (e instanceof Error ? e.message : String(e)).split('\n')[0];
  const logs = (e as { logs?: string[] }).logs ?? [];
  const reason = logs.filter((l) => /frozen|reject|PermanentFreeze/i.test(l)).map((l) => l.replace(/^Program log: /, ''));
  return reason.length > 0 ? `${message} [${reason.join(' | ')}]` : `${message} [logs: ${logs.slice(-3).join(' | ')}]`;
}
const account = await fetchAssetV1(umi, publicKey(asset));
const collection = await fetchCollectionV1(umi, publicKey(config.collection));
for (const [what, builder] of [
  ['transfer', transfer(umi, { asset: account, collection, newOwner: generateSigner(umi).publicKey, authority: owner })],
  ['burn', burn(umi, { asset: account, collection, authority: owner })],
] as const) {
  try {
    await sendTx(umi, builder);
    console.log(`${what.toUpperCase()} SUCCEEDED: the grimoire is NOT soulbound`);
  } catch (e) {
    console.log(`${what} refused as expected: ${refusal(e)}`);
  }
}
console.log(`https://explorer.solana.com/address/${asset}?cluster=devnet`);
