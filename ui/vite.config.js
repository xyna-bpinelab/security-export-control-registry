import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  // Serves ../countries at the site root (e.g. /jp/datasources.yaml), both in
  // `vite dev` and copied into dist/ on `vite build`. A relative "/../countries"
  // fetch URL does not work: browsers normalize ".." out of an absolute path
  // before the request is ever sent, so it always resolved to "/countries/..."
  // under site root and silently fell back to index.html.
  publicDir: resolve(__dirname, '../countries'),
  resolve: {
    alias: {
      '@countries': resolve(__dirname, '../countries')
    }
  }
});
