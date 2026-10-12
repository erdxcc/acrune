/**
 * Creates the soulbound "Acrune Grimoires" collection and records COLLECTION_ADDRESS in .env.
 * When COLLECTION_ADDRESS is already set, it updates the collection's name and metadata URI
 * instead, and points every grimoire in it at PUBLIC_BASE_URL: run it again after the relayer
 * moves to its deployed URL.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createCollection, fetchAssetsByCollection, fetchCollectionV1, update, updateCollection } from '@metaplex-foundation/mpl-core';
import { generateSigner, publicKey } from '@metaplex-foundation/umi';
import { COLLECTION_NAME } from '../src/brand';
import { loadConfig } from '../src/config';
import { relayerUmi, sendTx } from '../src/solana';

const config = loadConfig();
const umi = relayerUmi(config.rpcUrl, config.secretKey);
const uri = `${config.publicBaseUrl}/meta/collection.json`;

if (config.collection) {
  const current = await fetchCollectionV1(umi, publicKey(config.collection));
  if (current.name === COLLECTION_NAME && current.uri === uri) {
    console.log(`Collection ${config.collection} is up to date (${uri})`);
  } else {
    const { signature, confirmed } = await sendTx(umi, updateCollection(umi, { collection: current.publicKey, name: COLLECTION_NAME, uri }));
    console.log(`Collection ${config.collection} updated: "${COLLECTION_NAME}", ${uri} (${confirmed ? 'confirmed' : 'not confirmed yet'})`);
    console.log(`tx ${signature}`);
  }
  const collection = await fetchCollectionV1(umi, publicKey(config.collection));
  const assets = await fetchAssetsByCollection(umi, collection.publicKey);
  let moved = 0;
  for (const asset of assets) {
    const assetUri = `${config.publicBaseUrl}/meta/${asset.publicKey}.json`;
    if (asset.uri === assetUri) continue;
    await sendTx(umi, update(umi, { asset, collection, uri: assetUri }));
    moved++;
  }
  console.log(`${assets.length} grimoire(s) in the collection, ${moved} re-pointed to ${config.publicBaseUrl}`);
} else {
  const collection = generateSigner(umi);
  const { signature, confirmed } = await sendTx(
    umi,
    createCollection(umi, {
      collection,
      name: COLLECTION_NAME,
      uri,
      plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }],
    }),
  );
  const address = collection.publicKey.toString();
  console.log(`Collection ${address} (${confirmed ? 'confirmed' : 'not confirmed yet'})`);
  console.log(`https://explorer.solana.com/address/${address}?cluster=devnet`);
  console.log(`tx ${signature}`);

  const envPath = new URL('../.env', import.meta.url);
  const env = readFileSync(envPath, 'utf8');
  writeFileSync(envPath, /^COLLECTION_ADDRESS=.*$/m.test(env) ? env.replace(/^COLLECTION_ADDRESS=.*$/m, `COLLECTION_ADDRESS=${address}`) : `${env}COLLECTION_ADDRESS=${address}\n`);
  console.log('Saved COLLECTION_ADDRESS to apps/relayer/.env');
}
