import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5174, watch: { usePolling: true, interval: 300 } },
});
