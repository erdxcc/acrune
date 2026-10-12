/** Creates apps/relayer/.env with a fresh relayer keypair and secrets. Never overwrites. */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';

const path = new URL('../.env', import.meta.url);
if (existsSync(path)) {
  console.log('apps/relayer/.env already exists, leaving it as is.');
  process.exit(0);
}
const keypair = createUmi('https://api.devnet.solana.com').eddsa.generateKeypair();
const lines = [
  'SOLANA_RPC_URL=https://api.devnet.solana.com',
  `RELAYER_SECRET_KEY=${JSON.stringify(Array.from(keypair.secretKey))}`,
  `ASSET_SEED_SECRET=${randomBytes(32).toString('base64url')}`,
  `TOKEN_HMAC_SECRET=${randomBytes(32).toString('base64url')}`,
  'COLLECTION_ADDRESS=',
  'PUBLIC_BASE_URL=http://localhost:8787',
  'GAME_URL=https://idosgames.com',
  'IDOS_API_BASE=https://api.idosgames.com',
  'ALLOWED_TITLES=',
];
writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote apps/relayer/.env. Relayer address: ${keypair.publicKey}`);
console.log('Fund it with devnet SOL: pnpm --filter @grimoire/relayer airdrop');
