import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CharacterGitHub,
  CharacterGitHubError,
  GitHubBindingSchema,
} from '../packages/github/src/index';
import { loadGitHubBinding, saveGitHubBinding } from '../packages/github/src/store';

async function main() {
  const { values, positionals } = parseArgs({
    options: { character: { type: 'string', default: 'hubert' }, replace: { type: 'boolean' } },
    allowPositionals: true,
  });
  const command = positionals[0] ?? 'help';
  const characterId = values.character!;
  if (positionals.length > 1 || !['help', 'stage', 'check', 'status'].includes(command))
    throw new CharacterGitHubError('input');
  if (command === 'help') {
    console.log(
      'pnpm github:setup [stage|check|status] [--character hubert] [--replace]\n\nStage reads metadata and a private key FILE PATH from operator environment; it makes no network calls.\nCheck exchanges a short-lived installation token and reads only configured repository metadata.\nOnly Hubert is currently admitted. Setup does not create a GitHub App/account/repository or publish files.\nSee docs/architecture/character-github.md.',
    );
    return;
  }
  if (characterId !== 'hubert') throw new CharacterGitHubError('scope');
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (command === 'stage') {
    const env = process.env;
    const parsed = GitHubBindingSchema.safeParse({
      actor: { worldId: 'elsewhere', ownerUserId: env.HUBERT_OWNER_USER_ID, characterId },
      appId: Number(env.GITHUB_APP_ID),
      installationId: Number(env.GITHUB_INSTALLATION_ID),
      privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH,
      repositories: JSON.parse(env.GITHUB_CHARACTER_REPOSITORIES ?? 'null') as unknown,
    });
    if (!parsed.success) throw new CharacterGitHubError('configuration');
    new CharacterGitHub(parsed.data); // Validate the private RSA file locally; no provider request.
    saveGitHubBinding(root, parsed.data, values.replace);
    console.log('GitHub metadata staged for Hubert. No connection check or publication performed.');
    return;
  }
  const binding = loadGitHubBinding(root, characterId);
  if (!binding) {
    console.log('GitHub is not configured for Hubert.');
    if (command === 'check') process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    console.log(
      `GitHub metadata staged for Hubert (${binding.repositories.length} selected repositories); not a verified live connection.`,
    );
    return;
  }
  const results = await new CharacterGitHub(binding).probe(binding.actor);
  console.log(
    `GitHub connection verified for ${results.length} selected repositories. No files changed.`,
  );
  for (const result of results)
    console.log(
      `${result.fullName}: ${result.private ? 'private' : 'public'}; ${result.writableBranch ? 'configured working branch differs from default' : 'writes blocked: configured branch is default'}`,
    );
}
void main().catch(() => {
  // Never print JSON validation diagnostics, paths, key material or provider response bodies.
  console.error(
    'GitHub setup/check failed. Verify private file permissions, owner binding, App installation and selected repository permissions. See docs/architecture/character-github.md.',
  );
  process.exitCode = 1;
});
