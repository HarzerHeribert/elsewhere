import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { pinnedHttpsFetch } from './pinned-https';

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function certificate(hostname: string) {
  const path = mkdtempSync(join(tmpdir(), 'elsewhere-tls-fixture-'));
  directories.push(path);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${hostname}`,
      '-addext',
      `subjectAltName=DNS:${hostname}`,
      '-keyout',
      join(path, 'key'),
      '-out',
      join(path, 'cert'),
    ],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(join(path, 'key')), cert: readFileSync(join(path, 'cert'), 'utf8') };
}
it('trusts only the configured certificate and retains hostname checking before sending credentials', async () => {
  const correct = certificate('localhost');
  const other = certificate('other.example');
  let requests = 0;
  const server = createServer(correct, (request, response) => {
    requests++;
    response.end('verified');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  try {
    expect(
      await (await pinnedHttpsFetch(correct.cert)(`https://localhost:${address.port}`)).text(),
    ).toBe('verified');
    await expect(
      pinnedHttpsFetch(other.cert)(`https://localhost:${address.port}`, {
        headers: { authorization: 'fixture-secret' },
      }),
    ).rejects.toThrow('TLS connection');
    await expect(
      pinnedHttpsFetch(correct.cert)(`https://127.0.0.1:${address.port}`, {
        headers: { authorization: 'fixture-secret' },
      }),
    ).rejects.toThrow('TLS connection');
    expect(requests).toBe(1);
    await expect(
      pinnedHttpsFetch(correct.cert)(`http://localhost:${address.port}`),
    ).rejects.toThrow('TLS request');
    expect(() => pinnedHttpsFetch(correct.key.toString())).toThrow('certificate is invalid');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
