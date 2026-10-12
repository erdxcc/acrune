import { createApp } from './app';
import { loadConfig } from './config';
import { IdosApi } from './idos';
import { createChain } from './solana';

/** Vercel entry of the `relayer` service in vercel.json; Vercel bundles it and serves the app. */
const config = loadConfig();
const app = createApp({ config, idos: new IdosApi(config.idosApiBase), chain: createChain(config) });

export default app;
