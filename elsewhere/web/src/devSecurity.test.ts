import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import config from '../vite.config';

it('serves public development files while denying private state and keys, including raw imports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elsewhere-vite-security-'));
  const canary = 'fixture-private-canary-not-a-real-key';
  const privatePaths = [
    '.data/chatgpt/default.json',
    '.data/credentials/hubert/model.json',
    '.env.deploy.local',
    '.codex/auth.json',
    '.aws/credentials',
    'notes.local.md',
  ];
  for (const path of privatePaths) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, canary);
  }
  writeFileSync(join(root, 'public.txt'), 'public fixture');
  const server = await createServer({
    ...config,
    root,
    configFile: false,
    envFile: false,
    plugins: [],
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...config.server,
      port: 0,
      hmr: false,
      proxy: undefined,
      watch: null,
      fs: { ...config.server?.fs, allow: [root] },
    },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const origin = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(`${origin}/public.txt`)).text()).toBe('public fixture');
    for (const path of privatePaths) {
      for (const query of ['', '?raw&import']) {
        const response = await fetch(`${origin}/@fs/${join(root, path)}${query}`);
        expect(response.status, path + query).toBe(403);
        expect(await response.text()).not.toContain(canary);
      }
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
