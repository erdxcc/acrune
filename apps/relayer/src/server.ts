import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { IdosApi } from './idos';
import { createChain } from './solana';

/** Local development server: `pnpm dev` with apps/relayer/.env. */
const config = loadConfig();
const chain = createChain(config);
const app = createApp({ config, idos: new IdosApi(config.idosApiBase), chain });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`relayer on http://localhost:${info.port} (${chain ? 'Solana writes on' : 'Solana writes off: set RELAYER_SECRET_KEY and COLLECTION_ADDRESS'})`);
});
