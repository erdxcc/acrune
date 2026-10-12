import { getRequestListener } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { IdosApi } from './idos';
import { createChain } from './solana';

/** Vercel Node function entry, bundled by scripts/build-vercel.mjs. */
const config = loadConfig();
const app = createApp({ config, idos: new IdosApi(config.idosApiBase), chain: createChain(config) });

export default getRequestListener(app.fetch);
