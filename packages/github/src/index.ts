import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const positive = z.number().int().positive().safe();
const branch = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
  .refine((value) => !value.endsWith('/') && !value.includes('//'));
export const GitHubActorSchema = z
  .object({ worldId: identifier, ownerUserId: identifier, characterId: identifier })
  .strict();
export type GitHubActor = z.infer<typeof GitHubActorSchema>;
export const GitHubBindingSchema = z
  .object({
    actor: GitHubActorSchema,
    appId: positive,
    installationId: positive,
    privateKeyPath: z.string().max(4096).refine(isAbsolute),
    repositories: z
      .array(
        z
          .object({
            id: positive,
            fullName: z
              .string()
              .regex(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/)
              .max(200),
            branch,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.repositories.map((repo) => repo.id)).size === value.repositories.length &&
      new Set(value.repositories.map((repo) => repo.fullName.toLowerCase())).size ===
        value.repositories.length,
  );
export type GitHubBinding = z.infer<typeof GitHubBindingSchema>;

/** Controlled errors: provider response bodies, tokens and private keys are never logged. */
export class CharacterGitHubError extends Error {
  constructor(
    readonly code:
      | 'configuration'
      | 'scope'
      | 'unavailable'
      | 'invalid_response'
      | 'input'
      | 'not_found'
      | 'protected_branch',
    /** The provider's HTTP status when it refused a request; never its body. */
    readonly status?: number,
  ) {
    super(`Character GitHub connection: ${code}.`);
  }
}

function privateKey(path: string) {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 32768 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error();
    const key = createPrivateKey(readFileSync(fd));
    if (key.asymmetricKeyType !== 'rsa') throw new Error();
    return key;
  } catch {
    throw new CharacterGitHubError('configuration');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async function responseJson(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new CharacterGitHubError('unavailable', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CharacterGitHubError('invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) throw new CharacterGitHubError('invalid_response');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
const pathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => {
    const parts = value.split('/');
    return (
      parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..') &&
      !parts.includes('.git') &&
      parts[0] !== '.github' &&
      !parts.some((part) => /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|key)$/i.test(part))
    );
  });
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const repositoryResult = z.object({
  id: positive,
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
});

/** Host-side adapter. No browser, model, or connector proposal receives credentials. */
export class CharacterGitHub {
  readonly binding: GitHubBinding;
  private readonly key: ReturnType<typeof privateKey>;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(binding: unknown, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
    const parsed = GitHubBindingSchema.safeParse(binding);
    if (!parsed.success) throw new CharacterGitHubError('configuration');
    this.binding = parsed.data;
    this.key = privateKey(this.binding.privateKeyPath);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }
  private repository(actor: GitHubActor, repositoryId: number) {
    if (
      actor.worldId !== this.binding.actor.worldId ||
      actor.ownerUserId !== this.binding.actor.ownerUserId ||
      actor.characterId !== this.binding.actor.characterId
    )
      throw new CharacterGitHubError('scope');
    const repository = this.binding.repositories.find((repo) => repo.id === repositoryId);
    if (!repository) throw new CharacterGitHubError('scope');
    return repository;
  }
  private async request(path: string, token: string, method = 'GET', body?: unknown) {
    try {
      return await responseJson(
        await this.fetcher('https://api.github.com' + path, {
          method,
          headers: {
            authorization: 'Bearer ' + token,
            accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2026-03-10',
            'content-type': 'application/json',
            'user-agent': 'Elsewhere-character-projects',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        }),
      );
    } catch (error) {
      if (error instanceof CharacterGitHubError) throw error;
      throw new CharacterGitHubError('unavailable');
    }
  }
  private async token(repositoryId: number, access: 'read' | 'write') {
    const now = Math.floor(this.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(this.binding.appId) }),
    ).toString('base64url');
    const value = header + '.' + payload;
    const jwt =
      value + '.' + sign('RSA-SHA256', Buffer.from(value), this.key).toString('base64url');
    const result = z
      .object({ token: z.string().min(1).max(16384), expires_at: z.string().datetime() })
      .safeParse(
        await this.request(
          `/app/installations/${this.binding.installationId}/access_tokens`,
          jwt,
          'POST',
          {
            repository_ids: [repositoryId],
            permissions: { contents: access, metadata: 'read' },
          },
        ),
      );
    if (!result.success || Date.parse(result.data.expires_at) <= this.now())
      throw new CharacterGitHubError('invalid_response');
    return result.data.token;
  }
  private async metadata(repository: GitHubBinding['repositories'][number], token: string) {
    const parsed = repositoryResult.safeParse(
      await this.request('/repos/' + repository.fullName, token),
    );
    if (
      !parsed.success ||
      parsed.data.id !== repository.id ||
      parsed.data.full_name.toLowerCase() !== repository.fullName.toLowerCase()
    )
      throw new CharacterGitHubError('invalid_response');
    return parsed.data;
  }
  async probe(actor: GitHubActor) {
    const results = [];
    for (const configured of this.binding.repositories) {
      const repository = this.repository(actor, configured.id);
      const token = await this.token(repository.id, 'read');
      const metadata = await this.metadata(repository, token);
      results.push({
        id: repository.id,
        fullName: metadata.full_name,
        branch: repository.branch,
        private: metadata.private,
        writableBranch: repository.branch !== metadata.default_branch,
      });
    }
    return results;
  }
  async readFile(actor: GitHubActor, input: { repositoryId: number; path: string }) {
    const repository = this.repository(actor, input.repositoryId);
    const path = pathSchema.safeParse(input.path);
    if (!path.success) throw new CharacterGitHubError('input');
    const token = await this.token(repository.id, 'read');
    await this.metadata(repository, token);
    let body: unknown;
    try {
      body = await this.request(
        `/repos/${repository.fullName}/contents/${path.data.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(repository.branch)}`,
        token,
      );
    } catch (error) {
      if (error instanceof CharacterGitHubError && error.status === 404)
        throw new CharacterGitHubError('not_found');
      throw error;
    }
    const file = z
      .object({
        type: z.literal('file'),
        sha,
        encoding: z.literal('base64'),
        content: z.string().max(180000),
        size: z.number().max(100000),
      })
      .safeParse(body);
    if (!file.success) throw new CharacterGitHubError('invalid_response');
    const content = Buffer.from(file.data.content, 'base64');
    if (content.length !== file.data.size || content.length > 100000)
      throw new CharacterGitHubError('invalid_response');
    return { sha: file.data.sha, text: content.toString('utf8'), branch: repository.branch };
  }
  /** A trusted broker must reserve/approve this exact request before calling; no hidden retries. */
  async writeFile(
    actor: GitHubActor,
    raw: {
      repositoryId: number;
      path: string;
      text: string;
      message: string;
      expectedSha?: string;
    },
  ) {
    const input = z
      .object({
        repositoryId: positive,
        path: pathSchema,
        text: z.string().max(100000),
        message: z.string().trim().min(1).max(200),
        expectedSha: sha.optional(),
      })
      .strict()
      .safeParse(raw);
    if (!input.success || Buffer.byteLength(input.data.text, 'utf8') > 100000)
      throw new CharacterGitHubError('input');
    const repository = this.repository(actor, input.data.repositoryId);
    const token = await this.token(repository.id, 'write');
    const metadata = await this.metadata(repository, token);
    if (repository.branch === metadata.default_branch)
      throw new CharacterGitHubError('protected_branch');
    const result = z.object({ commit: z.object({ sha }), content: z.object({ sha }) }).safeParse(
      await this.request(
        `/repos/${repository.fullName}/contents/${input.data.path.split('/').map(encodeURIComponent).join('/')}`,
        token,
        'PUT',
        {
          message: input.data.message,
          content: Buffer.from(input.data.text).toString('base64'),
          branch: repository.branch,
          ...(input.data.expectedSha ? { sha: input.data.expectedSha } : {}),
        },
      ),
    );
    if (!result.success) throw new CharacterGitHubError('invalid_response');
    return {
      commitSha: result.data.commit.sha,
      contentSha: result.data.content.sha,
      url: `https://github.com/${repository.fullName}/commit/${result.data.commit.sha}`,
      branch: repository.branch,
    };
  }
}
