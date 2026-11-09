import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterGitHub, type GitHubBinding } from './index';
import { loadGitHubBinding, saveGitHubBinding } from './store';

const epoch = Date.UTC(2026, 10, 9, 12);
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const actor = { worldId: 'elsewhere', ownerUserId: 'owner-user', characterId: 'hubert' };
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'character-github-'));
  directories.push(root);
  const key = join(root, 'app.pem');
  writeFileSync(key, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const binding: GitHubBinding = {
    actor,
    appId: 12,
    installationId: 34,
    privateKeyPath: key,
    repositories: [{ id: 56, fullName: 'elsewhere/hubert-projects', branch: 'hubert/work' }],
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init! });
    if (path.endsWith('/access_tokens'))
      return Response.json({
        token: 'PRIVATE-TOKEN',
        expires_at: new Date(epoch + 3600000).toISOString(),
      });
    if (path.includes('/contents/')) {
      if (init?.method === 'PUT')
        return Response.json({ commit: { sha: 'a'.repeat(40) }, content: { sha: 'b'.repeat(40) } });
      return Response.json({
        type: 'file',
        sha: 'a'.repeat(40),
        encoding: 'base64',
        content: Buffer.from('a real document').toString('base64'),
        size: 15,
      });
    }
    return Response.json({
      id: 56,
      full_name: 'elsewhere/hubert-projects',
      default_branch: 'main',
      private: true,
    });
  });
  return {
    root,
    key,
    binding,
    calls,
    fetcher,
    adapter: new CharacterGitHub(binding, { now: () => epoch, fetcher: fetcher as typeof fetch }),
  };
}

describe('actor-scoped GitHub App adapter', () => {
  it('mints a bounded RS256 app JWT and repository-scoped read token before verifying metadata', async () => {
    const f = fixture();
    expect(await f.adapter.probe(actor)).toEqual([
      {
        id: 56,
        fullName: 'elsewhere/hubert-projects',
        branch: 'hubert/work',
        private: true,
        writableBranch: true,
      },
    ]);
    const first = f.calls[0];
    expect(first.url).toBe('https://api.github.com/app/installations/34/access_tokens');
    expect(JSON.parse(String(first.init.body))).toEqual({
      repository_ids: [56],
      permissions: { contents: 'read', metadata: 'read' },
    });
    const jwt = (first.init.headers as Record<string, string>).authorization.slice(7);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      iss: '12',
      iat: epoch / 1000 - 60,
      exp: epoch / 1000 + 540,
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(header + '.' + payload),
        pair.publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(first.init.redirect).toBe('error');
  });
  it('denies another character, owner, world or unconfigured repository before network access', async () => {
    const f = fixture();
    for (const changed of [
      { ...actor, characterId: 'other' },
      { ...actor, ownerUserId: 'other' },
      { ...actor, worldId: 'other' },
    ])
      await expect(
        f.adapter.readFile(changed, { repositoryId: 56, path: 'README.md' }),
      ).rejects.toMatchObject({ code: 'scope' });
    await expect(
      f.adapter.readFile(actor, { repositoryId: 99, path: 'README.md' }),
    ).rejects.toMatchObject({ code: 'scope' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('reads only the configured branch and returns content rather than treating it as instructions', async () => {
    const f = fixture();
    expect(
      await f.adapter.readFile(actor, { repositoryId: 56, path: 'notes/question.md' }),
    ).toMatchObject({ text: 'a real document', branch: 'hubert/work' });
    expect(f.calls[2].url).toContain('/contents/notes/question.md?ref=hubert%2Fwork');
  });
  it('writes the exact file on a working branch with an expected SHA and returns a verifiable receipt', async () => {
    const f = fixture();
    const input = {
      repositoryId: 56,
      path: 'notes/question.md',
      text: 'A new observation.',
      message: 'Record observation',
      expectedSha: 'c'.repeat(40),
    };
    const result = await f.adapter.writeFile(actor, input);
    expect(JSON.parse(String(f.calls[0].init.body)).permissions.contents).toBe('write');
    expect(JSON.parse(String(f.calls[2].init.body))).toEqual({
      message: input.message,
      content: Buffer.from(input.text).toString('base64'),
      branch: 'hubert/work',
      sha: input.expectedSha,
    });
    expect(result.url).toBe(
      'https://github.com/elsewhere/hubert-projects/commit/' + 'a'.repeat(40),
    );
  });
  it('blocks default branch changes, workflows, secret files and traversal', async () => {
    const f = fixture();
    for (const path of [
      '../README.md',
      '.github/workflows/run.yml',
      '.env',
      'private.key',
      '/README.md',
    ])
      await expect(
        f.adapter.writeFile(actor, { repositoryId: 56, path, text: 'x', message: 'x' }),
      ).rejects.toMatchObject({ code: 'input' });
    expect(f.fetcher).not.toHaveBeenCalled();
    const adapter = new CharacterGitHub(
      { ...f.binding, repositories: [{ ...f.binding.repositories[0], branch: 'main' }] },
      { now: () => epoch, fetcher: f.fetcher as typeof fetch },
    );
    await expect(
      adapter.writeFile(actor, { repositoryId: 56, path: 'README.md', text: 'x', message: 'x' }),
    ).rejects.toMatchObject({ code: 'protected_branch' });
    expect(f.calls.some((call) => call.init.method === 'PUT')).toBe(false);
  });
  it('does not expose response details or retry a failed publication', async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async (_url, init) => {
      f.calls.push({ url: String(_url), init: init! });
      return Response.json({ error: 'PRIVATE-PROVIDER-SECRET' }, { status: 403 });
    });
    await expect(
      f.adapter.writeFile(actor, { repositoryId: 56, path: 'README.md', text: 'x', message: 'x' }),
    ).rejects.toThrow('Character GitHub connection: unavailable.');
    expect(f.calls).toHaveLength(1);
  });
  it('rejects a renamed or mismatched repository even with a valid installation token', async () => {
    const f = fixture();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) =>
      String(url).endsWith('/access_tokens')
        ? original(url, init)
        : Response.json({
            id: 999,
            full_name: 'elsewhere/hubert-projects',
            default_branch: 'main',
            private: true,
          }),
    );
    await expect(
      f.adapter.readFile(actor, { repositoryId: 56, path: 'README.md' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('private GitHub binding storage', () => {
  it('stages metadata without a key copy, refuses accidental overwrite and loads the same scoped record', () => {
    const f = fixture();
    saveGitHubBinding(f.root, f.binding);
    const path = join(f.root, '.data/credentials/hubert/github.json');
    expect(readFileSync(path, 'utf8')).not.toContain('PRIVATE KEY');
    expect(loadGitHubBinding(f.root, 'hubert')).toEqual(f.binding);
    expect(() => saveGitHubBinding(f.root, f.binding)).toThrow();
    saveGitHubBinding(f.root, f.binding, true);
  });
  it('rejects public and symlinked keys and symlinked metadata directories', () => {
    const f = fixture();
    chmodSync(f.key, 0o644);
    expect(() => new CharacterGitHub(f.binding)).toThrow('configuration');
    chmodSync(f.key, 0o600);
    const link = join(f.root, 'key-link.pem');
    symlinkSync(f.key, link);
    expect(() => new CharacterGitHub({ ...f.binding, privateKeyPath: link })).toThrow(
      'configuration',
    );
    symlinkSync(f.root, join(f.root, '.data'));
    expect(() => saveGitHubBinding(f.root, f.binding)).toThrow('configuration');
  });
});
