import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Dev only: publicDir can only mount one directory, but we need both
// ../countries (datasources.yaml) and ../data (entities JSON) reachable at
// the site root during `vite dev`. This middleware serves ../data/* the
// same way publicDir serves ../countries/*; production builds fetch both
// from raw.githubusercontent.com instead (see src/api.js).
function serveDataDir() {
  const dataRoot = resolve(__dirname, '../data');
  return {
    name: 'serve-data-dir',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/data/')) return next();
        const filePath = resolve(dataRoot, '.' + req.url.slice('/data'.length));
        if (!filePath.startsWith(dataRoot) || !existsSync(filePath)) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(readFileSync(filePath));
      });
    }
  };
}

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
  plugins: command === 'serve' ? [serveDataDir()] : [],
  resolve: {
    alias: {
      '@countries': resolve(__dirname, '../countries')
    }
  }
}));
