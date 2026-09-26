// SPDX-License-Identifier: Apache-2.0
// Static build of the workbench for the desktop app (served by the local service).
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'desktop/web',
  base: './',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: { alias: { '@': root } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist-desktop/web', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    assetsDir: 'assets',
  },
  server: {
    port: 4318,
    proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true } },
  },
});
