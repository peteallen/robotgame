import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/robotgame/' : '/',
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
});
