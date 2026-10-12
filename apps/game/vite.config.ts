import { defineConfig } from 'vite';

// Relative base: the same build runs on {titleid}.idos.games, inside the
// idosgames.com iframe and from any static host.
export default defineConfig({
  base: './',
  server: {
    host: true,
    // The repo lives on a Windows drive under WSL, where file events do not arrive.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
