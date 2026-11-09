import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
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
  build: { outDir: 'dist' },
});
