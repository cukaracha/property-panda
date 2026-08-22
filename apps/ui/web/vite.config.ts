import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Topic pages import their content straight from the seed corpus (the KB
    // source of truth), which lives outside the app root at <repo>/infra/seed.
    // This app is nested three levels deep (apps/ui/web), so the repo root is ../../..
    alias: { '@seed': fileURLToPath(new URL('../../../infra/seed', import.meta.url)) },
  },
  server: {
    port: 3000,
    // Allow the dev server to read the seed markdown (outside the Vite root).
    fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] },
  },
});
