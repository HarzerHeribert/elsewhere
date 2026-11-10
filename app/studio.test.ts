import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredStudio, createFolderStudio } from './studio';

const directories: string[] = [];
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'studio-'));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('folder studio', () => {
  it('writes files below the folder, creating parents, and reads them back by hash', async () => {
    const root = folder();
    const studio = createFolderStudio(root, 'https://studio.invalid');
    expect(studio.site()).toEqual({ url: 'https://studio.invalid/' });
    expect(await studio.read('notes/fin.md')).toBeNull();
    const written = await studio.write({ path: 'notes/fin.md', text: '# Fin', message: 'Fin' });
    expect(readFileSync(join(root, 'notes/fin.md'), 'utf8')).toBe('# Fin');
    expect(written.pageUrl).toBe('https://studio.invalid/notes/fin.html');
    const read = await studio.read('notes/fin.md');
    expect(read).toEqual({ text: '# Fin', sha: written.commitSha });
    expect(written.commitSha).toMatch(/^[a-f0-9]{64}$/);
    expect((await studio.write({ path: 'index.html', text: '<p>', message: 'i' })).pageUrl).toBe(
      'https://studio.invalid/',
    );
    expect((await studio.write({ path: 'a/index.html', text: '<p>', message: 'i' })).pageUrl).toBe(
      'https://studio.invalid/a/',
    );
    expect((await studio.write({ path: 'a.css', text: 'a{}', message: 'c' })).pageUrl).toBe(
      'https://studio.invalid/a.css',
    );
  });

  it('refuses any path that leaves the folder', async () => {
    const root = folder();
    const studio = createFolderStudio(join(root, 'site'), 'https://studio.invalid/');
    for (const path of ['../escape.md', 'a/../../escape.md', '/etc/escape.md', '']) {
      await expect(studio.write({ path, text: 'x', message: 'm' })).rejects.toThrow();
      await expect(studio.read(path)).rejects.toThrow();
    }
    expect(existsSync(join(root, 'escape.md'))).toBe(false);
  });
});

describe('configured studio', () => {
  const base = { production: false, STUDIO_FOLDER_URL: 'https://studio.invalid/' };
  it('uses the folder outside production and nothing without a binding', () => {
    const root = folder();
    expect(configuredStudio({ ...base, STUDIO_FOLDER: root }, 'hubert', root)?.site().url).toBe(
      'https://studio.invalid/',
    );
    expect(configuredStudio(base, 'hubert', root)).toBeUndefined();
    expect(
      configuredStudio({ ...base, production: true, STUDIO_FOLDER: root }, 'hubert', root),
    ).toBeUndefined();
  });
});

describe('a studio configured through secret settings', () => {
  it('builds the GitHub studio from the settings and keeps the key in a private file', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { configuredStudio } = await import('./studio');
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs1', format: 'pem' })
      .toString();
    const settings = {
      production: true,
      STUDIO_FOLDER_URL: 'https://studio.invalid/',
      STUDIO_GITHUB_APP_ID: 12,
      STUDIO_GITHUB_INSTALLATION_ID: 34,
      STUDIO_GITHUB_REPOSITORY: JSON.stringify({
        id: 56,
        fullName: 'someone/someone.github.io',
        branch: 'work',
      }),
      STUDIO_GITHUB_PRIVATE_KEY_B64: Buffer.from(pem).toString('base64'),
    };
    const actor = { worldId: 'elsewhere', ownerUserId: 'owner-1', characterId: 'resident' };
    const studio = configuredStudio(settings, 'resident', '/nonexistent-root', actor);
    expect(studio?.site().url).toBe('https://someone.github.io/');
    expect(
      configuredStudio(
        { ...settings, STUDIO_GITHUB_APP_ID: undefined },
        'resident',
        '/nonexistent-root',
        actor,
      ),
    ).toBeUndefined();
  });
});
