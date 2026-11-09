import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

export const CredentialServiceSchema = z.enum(['model', 'stripe', 'email']);
export type CredentialService = z.infer<typeof CredentialServiceSchema>;
const characterIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const secret = z
  .string()
  .min(12)
  .max(4096)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const modelUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });

export const credentialSchemas = {
  model: z
    .object({
      baseUrl: modelUrl,
      model: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[^\x00-\x1f\x7f]+$/),
      apiKey: secret,
      maxCallsPerDay: z.number().int().min(1).max(1000),
    })
    .strict(),
  stripe: z
    .object({
      restrictedKey: secret.regex(/^rk_test_[a-zA-Z0-9]+$/),
      webhookSecret: z
        .string()
        .regex(/^whsec_[a-zA-Z0-9]+$/)
        .max(4096)
        .optional(),
    })
    .strict(),
  email: z
    .object({
      apiKey: secret.regex(/^re_[a-zA-Z0-9_]+$/),
      fromAddress: z.string().email().max(254),
    })
    .strict(),
};
export type CredentialValues = {
  [S in CredentialService]: z.infer<(typeof credentialSchemas)[S]>;
};
export interface CredentialProfile<S extends CredentialService> {
  version: 1;
  service: S;
  characterId: string;
  savedAt: string;
  values: CredentialValues[S];
}

/** Controlled messages only: validation must never print a rejected credential value. */
export class CredentialStoreError extends Error {}

function assertPrivate(info: Stats, directory = false) {
  if (
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) ||
    (process.getuid && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0
  )
    throw new CredentialStoreError(
      'Credential storage must be owned by you and private (700 directories, 600 files).',
    );
}

function profilePath(
  root: string,
  characterId: string,
  service: CredentialService,
  create = false,
) {
  if (process.platform === 'win32')
    throw new CredentialStoreError(
      'This local credential store currently requires macOS or Linux file permissions.',
    );
  if (
    !characterIdSchema.safeParse(characterId).success ||
    !CredentialServiceSchema.safeParse(service).success
  )
    throw new CredentialStoreError('Choose a supported service and a lowercase character ID.');
  let path = root;
  for (const part of ['.data', 'credentials', characterId]) {
    path = join(path, part);
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new CredentialStoreError(
          'Credential directories cannot be symbolic links or non-directories.',
        );
      // Do not silently change an existing user directory's access policy.
      assertPrivate(info, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!create) return null;
      mkdirSync(path, { mode: 0o700 });
      chmodSync(path, 0o700);
    }
  }
  return join(path, `${service}.json`);
}

export function loadCredentialProfile<S extends CredentialService>(
  root: string,
  characterId: string,
  service: S,
): CredentialProfile<S> | null {
  const path = profilePath(root, characterId, service);
  if (!path) return null;
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CredentialStoreError('The credential record could not be opened safely.');
  }
  try {
    const info = fstatSync(fd);
    assertPrivate(info);
    if (info.size > 16384) throw new CredentialStoreError('The credential record is too large.');
    const envelope = z
      .object({
        version: z.literal(1),
        service: z.literal(service),
        characterId: z.literal(characterId),
        savedAt: z.string().datetime(),
        values: credentialSchemas[service],
      })
      .strict()
      .safeParse(JSON.parse(readFileSync(fd, 'utf8')));
    if (!envelope.success) throw new Error('invalid');
    return envelope.data as CredentialProfile<S>;
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError(
      'The credential record is invalid; its contents were not displayed.',
    );
  } finally {
    closeSync(fd);
  }
}

/** Local plaintext storage with OS permissions, not a production/encrypted vault. No network I/O. */
export function saveCredentialProfile<S extends CredentialService>(
  root: string,
  characterId: string,
  service: S,
  values: CredentialValues[S],
  { replace = false }: { replace?: boolean } = {},
) {
  const parsed = credentialSchemas[service]?.safeParse(values);
  if (!parsed?.success)
    throw new CredentialStoreError(
      'Settings are invalid. No credential values were displayed or saved.',
    );
  const path = profilePath(root, characterId, service, true)!;
  const lock = `${path}.lock`;
  let lockFd: number;
  try {
    lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch {
    throw new CredentialStoreError(
      'Credential storage is locked. Another setup may be running; check for a stale .lock file after a crash.',
    );
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const current = loadCredentialProfile(root, characterId, service);
    if (current && !replace)
      throw new CredentialStoreError(
        'Settings already exist; replacement needs explicit confirmation in setup.',
      );
    const record: CredentialProfile<S> = {
      version: 1,
      service,
      characterId,
      savedAt: new Date().toISOString(),
      values: parsed.data as CredentialValues[S],
    };
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lockFd);
    unlinkSync(lock);
  }
}

/** Only the explicitly selected model is delivered to the API; staged service keys stay on disk. */
export function configuredDevelopmentEnvironments(
  values: CredentialValues['model'],
  parent: NodeJS.ProcessEnv,
): { api: NodeJS.ProcessEnv; web: NodeJS.ProcessEnv } {
  const parsed = credentialSchemas.model.safeParse(values);
  if (!parsed.success) throw new CredentialStoreError('The saved model settings are invalid.');
  const web = Object.fromEntries(
    Object.entries(parent).filter(
      ([key]) =>
        !/^(MODEL_|CHATGPT_|OPENAI_|INFERENCE_|OLLAMA_|STRIPE_|RESEND_|TELEGRAM_|GITHUB_|GH_|BETTER_AUTH_|AUTH_|DATABASE_URL$|ADMIN_TOKEN$)/.test(
          key,
        ),
    ),
  );
  return {
    api: {
      ...parent,
      MODEL_PROVIDER: 'compatible',
      MODEL_BASE_URL: parsed.data.baseUrl,
      MODEL_NAME: parsed.data.model,
      MODEL_API_KEY: parsed.data.apiKey,
      MODEL_MAX_CALLS_PER_DAY: String(parsed.data.maxCallsPerDay),
    },
    web,
  };
}
