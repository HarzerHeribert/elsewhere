import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { tsImport } from 'tsx/esm/api';

const { createInitialWorld, publicWorld } = (await tsImport(
  '../server/src/world.ts',
  import.meta.url,
)) as typeof import('../server/src/world');

const { bounds, places, obstacles, objects } = publicWorld(createInitialWorld(0));
export default defineConfig({
  plugins: [react()],
  // Only the public, authored scenery is bundled. Residents and runtime always come from the API.
  define: { __ELSEWHERE_SCENERY__: JSON.stringify({ bounds, places, obstacles, objects }) },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    // Workspace imports are allowed; operator credentials and lived databases never are.
    fs: {
      deny: [
        '**/.env',
        '**/.env.*',
        '**/.git/**',
        '**/.data/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/.aws/**',
        '**/.vercel/**',
        '**/.render/**',
        '**/*.local.*',
        '**/*.sqlite*',
        '**/*.db',
        '**/*.{crt,pem,key,p12,pfx,cer,der}',
        '**/.npmrc',
        '**/.yarnrc.yml',
      ],
    },
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 4000}` },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        world: fileURLToPath(new URL('./index.html', import.meta.url)),
        designSystem: fileURLToPath(new URL('./design-system.html', import.meta.url)),
      },
    },
  },
});
