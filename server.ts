import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { Store } from './src/server/store.ts';
import { createApiApp } from './src/server/app.ts';

dotenv.config();

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.PATTERNSIGHT_DB || path.join(ROOT_DIR, 'data', 'patternsight.sqlite3');

async function startServer() {
  const store = new Store(DB_PATH);
  const app = createApiApp(store, { rootDir: ROOT_DIR });

  const distPath = path.join(ROOT_DIR, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PatternSight server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PatternSight server:', err);
  process.exit(1);
});
