import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CharacterGitHubError, GitHubBindingSchema, type GitHubBinding } from './index';

function bindingPath(root: string, characterId: string, create: boolean) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(characterId)) throw new CharacterGitHubError('configuration');
  let current = root;
  for (const part of ['.data', 'credentials', characterId]) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new CharacterGitHubError('configuration');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!create) return null;
      mkdirSync(current, { mode: 0o700 });
    }
  }
  return join(current, 'github.json');
}

export function loadGitHubBinding(root: string, characterId: string): GitHubBinding | null {
  const path = bindingPath(root, characterId, false);
  if (!path) return null;
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 16384 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error();
    const binding = GitHubBindingSchema.safeParse(JSON.parse(readFileSync(fd, 'utf8')));
    if (!binding.success || binding.data.actor.characterId !== characterId) throw new Error();
    return binding.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CharacterGitHubError('configuration');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Metadata/path only; the downloaded RSA private key remains in its private operator file. */
export function saveGitHubBinding(root: string, raw: unknown, replace = false) {
  const parsed = GitHubBindingSchema.safeParse(raw);
  if (!parsed.success) throw new CharacterGitHubError('configuration');
  const path = bindingPath(root, parsed.data.actor.characterId, true)!;
  const existing = loadGitHubBinding(root, parsed.data.actor.characterId);
  if (existing && !replace) throw new CharacterGitHubError('configuration');
  const temporary = path + '.' + randomUUID();
  try {
    writeFileSync(temporary, JSON.stringify(parsed.data, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {}
  }
}
