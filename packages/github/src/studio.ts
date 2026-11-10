import type { CharacterStudio } from '../../../characters/interfaces/src/studio';
import { studioPageUrl } from '../../../characters/interfaces/src/studio';
import { CharacterGitHubError, type CharacterGitHub, type GitHubActor } from './index';

/** `<owner>.github.io` repositories are the owner's site root; any other is served under its name. */
export function gitHubSiteUrl(fullName: string): string {
  const [owner, repo] = fullName.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

/** The studio port over one selected repository of the character's GitHub binding. */
export function createGitHubStudio(
  github: CharacterGitHub,
  actor: GitHubActor,
  repository: { id: number; fullName: string },
): CharacterStudio {
  const root = gitHubSiteUrl(repository.fullName);
  return {
    site: () => ({ url: root }),
    async read(path) {
      try {
        const file = await github.readFile(actor, { repositoryId: repository.id, path });
        return { text: file.text, sha: file.sha };
      } catch (error) {
        if (error instanceof CharacterGitHubError && error.code === 'not_found') return null;
        throw error;
      }
    },
    async write(input) {
      const result = await github.writeFile(actor, {
        repositoryId: repository.id,
        path: input.path,
        text: input.text,
        message: input.message,
        ...(input.expectedSha ? { expectedSha: input.expectedSha } : {}),
      });
      return {
        commitSha: result.commitSha,
        fileUrl: `https://github.com/${repository.fullName}/blob/${result.branch}/${input.path}`,
        pageUrl: studioPageUrl(root, input.path),
      };
    },
  };
}
