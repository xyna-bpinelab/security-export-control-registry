import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  root: '.',
  // Relative base so the built site works from any path (GitHub Pages project
  // sites are served from a subpath, e.g. /security-export-control-registry/).
  base: './',
  // Dev only: serves ../countries at the site root (e.g. /jp/datasources.yaml).
  // A relative "/../countries" fetch URL does not work: browsers normalize ".."
  // out of an absolute path before the request is ever sent, so it always
  // resolved to "/countries/..." under site root and silently fell back to
  // index.html. Production builds fetch from raw.githubusercontent.com instead
  // (see src/api.js), so nothing needs to be copied into dist/.
  publicDir: command === 'serve' ? resolve(__dirname, '../countries') : false,
  resolve: {
    alias: {
      '@countries': resolve(__dirname, '../countries')
    }
  }
}));
