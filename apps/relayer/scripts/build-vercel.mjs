// Bundles the relayer into one Node function using Vercel's Build Output API (.vercel/output).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const output = `${root}.vercel/output`;
const fn = `${output}/functions/index.func`;

rmSync(output, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [`${root}src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);
writeFileSync(`${output}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }, null, 2));
console.log(`wrote ${output}`);
