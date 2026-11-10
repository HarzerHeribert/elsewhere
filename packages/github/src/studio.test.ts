import { describe, expect, it, vi } from 'vitest';
import { CharacterGitHubError, type CharacterGitHub } from './index';
import { createGitHubStudio, gitHubSiteUrl } from './studio';

const actor = { worldId: 'elsewhere', ownerUserId: 'owner-user', characterId: 'hubert' };

function studioOver(fullName: string, github: Partial<CharacterGitHub>) {
  return createGitHubStudio(github as CharacterGitHub, actor, { id: 56, fullName });
}

describe('GitHub studio', () => {
  it('serves a user site from the root and any other repository under its name', () => {
    expect(gitHubSiteUrl('Fin/fin.github.io')).toBe('https://fin.github.io/');
    expect(gitHubSiteUrl('fin/notes')).toBe('https://fin.github.io/notes/');
    expect(studioOver('fin/notes', {}).site()).toEqual({ url: 'https://fin.github.io/notes/' });
  });

  it('maps files to the pages visitors see', async () => {
    const writeFile = vi.fn(async () => ({
      commitSha: 'a'.repeat(40),
      contentSha: 'b'.repeat(40),
      url: 'https://github.com/fin/notes/commit/' + 'a'.repeat(40),
      branch: 'work',
    }));
    const project = studioOver('fin/notes', { writeFile });
    const user = studioOver('fin/fin.github.io', { writeFile });
    const page = async (studio: typeof project, path: string) =>
      (await studio.write({ path, text: 'x', message: 'm' })).pageUrl;
    expect(await page(project, 'index.html')).toBe('https://fin.github.io/notes/');
    expect(await page(project, 'essays/index.html')).toBe('https://fin.github.io/notes/essays/');
    expect(await page(project, 'essays/fin-angle.md')).toBe(
      'https://fin.github.io/notes/essays/fin-angle.html',
    );
    expect(await page(project, 'style.css')).toBe('https://fin.github.io/notes/style.css');
    expect(await page(user, 'index.html')).toBe('https://fin.github.io/');
    expect(await page(user, 'a.md')).toBe('https://fin.github.io/a.html');
    const result = await project.write({
      path: 'a.md',
      text: 'x',
      message: 'Title',
      expectedSha: 'c'.repeat(40),
    });
    expect(result).toMatchObject({
      commitSha: 'a'.repeat(40),
      fileUrl: 'https://github.com/fin/notes/blob/work/a.md',
    });
    expect(writeFile).toHaveBeenLastCalledWith(actor, {
      repositoryId: 56,
      path: 'a.md',
      text: 'x',
      message: 'Title',
      expectedSha: 'c'.repeat(40),
    });
  });

  it('reads a file, treats a missing one as null and passes other failures on', async () => {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce({ sha: 'a'.repeat(40), text: 'hello', branch: 'work' })
      .mockRejectedValueOnce(new CharacterGitHubError('not_found'))
      .mockRejectedValueOnce(new CharacterGitHubError('unavailable'));
    const studio = studioOver('fin/notes', { readFile });
    expect(await studio.read('a.md')).toEqual({ text: 'hello', sha: 'a'.repeat(40) });
    expect(await studio.read('b.md')).toBeNull();
    await expect(studio.read('c.md')).rejects.toThrow('unavailable');
  });
});
