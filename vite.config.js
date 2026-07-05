import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Tiny shared "sock stash": socks collected in the basket persist on the dev
// server, so every browser in the house sees the same basket. On static hosts
// (GitHub Pages) the endpoint doesn't exist and the game falls back to
// per-browser localStorage.
const STASH_FILE = path.resolve(__dirname, '.sock-stash.json');

function sockStashMiddleware(middlewares) {
  middlewares.use('/api/socks', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      try {
        res.end(fs.readFileSync(STASH_FILE, 'utf8'));
      } catch {
        res.end('null');
      }
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on('end', () => {
        try {
          const socks = JSON.parse(body);
          if (Array.isArray(socks) && socks.length <= 16 && socks.every((s) => typeof s === 'string' && s.length < 16)) {
            fs.writeFileSync(STASH_FILE, JSON.stringify(socks));
            res.end('"ok"');
            return;
          }
        } catch { /* fall through */ }
        res.statusCode = 400;
        res.end('"bad socks"');
      });
      return;
    }
    res.statusCode = 405;
    res.end('null');
  });
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/robotgame/' : '/',
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
  plugins: [
    {
      name: 'sock-stash',
      configureServer(server) {
        sockStashMiddleware(server.middlewares);
      },
      configurePreviewServer(server) {
        sockStashMiddleware(server.middlewares);
      },
    },
  ],
});
