import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, devNull } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('audits force-staged private files and reports key findings without displaying their values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-public-audit-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull };
  const script = fileURLToPath(new URL('../scripts/public-audit.mjs', import.meta.url));
  const audit = () =>
    spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: directory, env });
    writeFileSync(join(directory, '.gitignore'), '.data/\n.env\n');
    writeFileSync(join(directory, 'app.ts'), 'export const example = true;');
    expect(audit().status).toBe(0);
    mkdirSync(join(directory, '.data'));
    writeFileSync(join(directory, '.data', 'owner-token'), 'fixture-private-owner');
    execFileSync('git', ['add', '-f', '.data/owner-token'], { cwd: directory, env });
    const staged = audit();
    expect(staged.status).toBe(1);
    expect(staged.stderr).toContain('private/local file');
    expect(staged.stderr).not.toContain('fixture-private-owner');
    execFileSync('git', ['rm', '--cached', '-f', '.data/owner-token'], { cwd: directory, env });
    const credential = 'sk_live_' + 'fixture'.repeat(6);
    writeFileSync(join(directory, 'bad.ts'), `export const accidental = '${credential}';`);
    const unsafe = audit();
    expect(unsafe.status).toBe(1);
    expect(unsafe.stderr).toContain('possible credential material');
    expect(unsafe.stderr).not.toContain(credential);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
