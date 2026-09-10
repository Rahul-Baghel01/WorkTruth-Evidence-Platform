import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// The frontend dev/preview server port. Named WEB_PORT (not PORT) so it
// can't collide with the API server's PORT when both run concurrently
// under `pnpm dev`.
const DEFAULT_WEB_PORT = 5173;

// Static builds never need a port; only dev/preview do. Reading the repo
// root .env here (in addition to the shell env) means `pnpm dev` works
// right after `cp .env.example .env`, with no export required.
const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, workspaceRoot, ''), ...process.env };
  const rawPort = env.WEB_PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_WEB_PORT;

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid WEB_PORT value: "${rawPort}"`);
  }

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      proxy: {
        '/api': {
          target: `http://localhost:${env.PORT || 5000}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
