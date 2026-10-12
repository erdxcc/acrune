import { z } from 'zod';

const schema = z.object({
  SOLANA_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
  /** Relayer keypair: JSON array of 64 bytes (solana-keygen format). Pays fees, owns the collection. */
  RELAYER_SECRET_KEY: z.string().optional(),
  /** Seeds the deterministic grimoire address of each wallet. */
  ASSET_SEED_SECRET: z.string().min(16),
  /** Signs run and progress tokens. */
  TOKEN_HMAC_SECRET: z.string().min(16),
  COLLECTION_ADDRESS: z.string().optional(),
  /** Where this relayer is reachable; metadata and image URLs point here. */
  PUBLIC_BASE_URL: z.string().url(),
  GAME_URL: z.string().url().default('https://idosgames.com'),
  IDOS_API_BASE: z.string().url().default('https://api.idosgames.com'),
  /** Comma-separated iDos title IDs this relayer serves, e.g. "ABCD1234,ABCD1234-DEV". */
  ALLOWED_TITLES: z.string().default(''),
});

export interface Config {
  rpcUrl: string;
  secretKey: Uint8Array | null;
  assetSeedSecret: string;
  tokenSecret: string;
  collection: string | null;
  publicBaseUrl: string;
  gameUrl: string;
  idosApiBase: string;
  allowedTitles: string[];
}

export function parseSecretKey(text: string): Uint8Array {
  const bytes = JSON.parse(text) as unknown;
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    throw new Error('RELAYER_SECRET_KEY must be a JSON array of 64 bytes');
  }
  return Uint8Array.from(bytes as number[]);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  return {
    rpcUrl: e.SOLANA_RPC_URL,
    secretKey: e.RELAYER_SECRET_KEY ? parseSecretKey(e.RELAYER_SECRET_KEY) : null,
    assetSeedSecret: e.ASSET_SEED_SECRET,
    tokenSecret: e.TOKEN_HMAC_SECRET,
    collection: e.COLLECTION_ADDRESS || null,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    gameUrl: e.GAME_URL,
    idosApiBase: e.IDOS_API_BASE.replace(/\/+$/, ''),
    allowedTitles: e.ALLOWED_TITLES.split(',').map((t) => t.trim()).filter(Boolean),
  };
}
