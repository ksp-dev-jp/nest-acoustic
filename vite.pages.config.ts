import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./pages', import.meta.url)),
  base: process.env.PAGES_BASE_PATH ?? '/nest-acoustic/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./pages/index.html', import.meta.url)),
      audit: fileURLToPath(new URL('./pages/audit.html', import.meta.url)),
    } },
    outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)),
    emptyOutDir: true,
  },
});
