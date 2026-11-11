import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  CharacterGitHub,
  GitHubBindingSchema,
  type GitHubActor,
  type GitHubBinding,
} from '../packages/github/src/index';
import { loadGitHubBinding } from '../packages/github/src/store';
import { createGitHubStudio } from '../packages/github/src/studio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { studioPageUrl, type CharacterStudio } from '../characters/interfaces/src/studio';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** A studio over a plain folder, for development and tests. Never reaches outside the folder. */
export function createFolderStudio(directory: string, baseUrl: string): CharacterStudio {
  const root = resolve(directory);
  const site = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const locate = (path: string) => {
    const target = resolve(root, path);
    const inside = relative(root, target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside))
      throw new Error('That path is outside the studio.');
    return target;
  };
  return {
    site: () => ({ url: site }),
    async read(path) {
      const target = locate(path);
      try {
        const text = await readFile(target, 'utf8');
        return { text, sha: digest(text) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(input) {
      const target = locate(input.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.text, 'utf8');
      const sha = digest(input.text);
      return {
        commitSha: sha,
        fileUrl: new URL(input.path, 'file://' + root + '/').href,
        pageUrl: studioPageUrl(site, input.path),
      };
    },
  };
}

/**
 * The studio this installation has, if any: a development folder, or the first repository of
 * the character's GitHub binding. Without either there is simply no studio; nothing is logged.
 */
export type HostedStudioSettings = {
  STUDIO_GITHUB_APP_ID?: number;
  STUDIO_GITHUB_INSTALLATION_ID?: number;
  /** JSON: { id, fullName, branch } of the one repository that is the site. */
  STUDIO_GITHUB_REPOSITORY?: string;
  /** The GitHub App's private key (PEM), base64-encoded. */
  STUDIO_GITHUB_PRIVATE_KEY_B64?: string;
};

/**
 * A host without a protected credentials folder passes the binding through its secret settings.
 * The key is written once to a private file of this process, where the GitHub client expects it.
 */
function hostedBinding(config: HostedStudioSettings, actor?: GitHubActor): GitHubBinding | null {
  const {
    STUDIO_GITHUB_APP_ID: appId,
    STUDIO_GITHUB_INSTALLATION_ID: installationId,
    STUDIO_GITHUB_REPOSITORY: repository,
    STUDIO_GITHUB_PRIVATE_KEY_B64: key,
  } = config;
  if (!actor || !appId || !installationId || !repository || !key) return null;
  const privateKeyPath = join(mkdtempSync(join(tmpdir(), 'studio-')), 'app.pem');
  writeFileSync(privateKeyPath, Buffer.from(key, 'base64'), { mode: 0o600, flag: 'wx' });
  return GitHubBindingSchema.parse({
    actor,
    appId,
    installationId,
    privateKeyPath,
    repositories: [JSON.parse(repository)],
  });
}

export function configuredStudio(
  config: {
    production: boolean;
    STUDIO_FOLDER?: string;
    STUDIO_FOLDER_URL: string;
  } & HostedStudioSettings,
  characterId: string,
  credentialsRoot = fileURLToPath(new URL('../', import.meta.url)),
  actor?: GitHubActor,
): CharacterStudio | undefined {
  if (config.STUDIO_FOLDER && !config.production)
    return createFolderStudio(config.STUDIO_FOLDER, config.STUDIO_FOLDER_URL);
  try {
    const binding = hostedBinding(config, actor) ?? loadGitHubBinding(credentialsRoot, characterId);
    const repository = binding?.repositories[0];
    if (!binding || !repository) return undefined;
    return createGitHubStudio(new CharacterGitHub(binding), binding.actor, repository);
  } catch {
    return undefined;
  }
}
