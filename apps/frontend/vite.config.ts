import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:' + (process.env.VIS4AGENT_PORT || '4318') } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
