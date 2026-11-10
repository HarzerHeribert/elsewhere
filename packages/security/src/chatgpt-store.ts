import {
  closeSync,
  constants,
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
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** Operator authentication, deliberately outside character snapshots and connectors. */
export class ChatGPTError extends Error {
  diagnostics?: { contentType: string; keys: string[]; object?: string; status?: string };
  /** The provider's own name for an unrecognised failure: a short identifier for the service log. */
  providerError?: string;
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(`ChatGPT connection: ${code}${status ? ` (HTTP ${status})` : ''}.`);
  }
}
const credential = z
  .string()
  .min(1)
  .max(24000)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const clientId = z
  .string()
  .regex(/^oaiapp_[A-Za-z0-9_-]+$/)
  .max(200);
const tokens = z
  .object({
    accessToken: credential,
    refreshToken: credential.optional(),
    idToken: credential,
    expiresAt: z.number().int().positive(),
    earliestRefreshAt: z.number().int().nonnegative().optional(),
    scopes: z.array(z.string().max(200)).max(32),
  })
  .strict();
export const chatGPTTransferStateSchema = z
  .object({
    id: z.string().uuid(),
    state: z.enum(['pending', 'delegated', 'received']),
    ownerUserId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    destination: z.string().max(200).optional(),
    container: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/)
      .optional(),
  })
  .strict();
export const chatGPTAccountSchema = z
  .object({
    version: z.literal(1),
    clientId,
    subject: z.string().min(1).max(300),
    issuer: z.literal('https://auth.openai.com'),
    email: z.string().email().max(254).optional(),
    tokens: tokens.optional(),
    transfer: chatGPTTransferStateSchema.optional(),
    pause: z
      .object({
        code: z
          .string()
          .regex(/^[a-z0-9_]+$/)
          .max(100),
        until: z.number().int().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChatGPTAccount = z.infer<typeof chatGPTAccountSchema>;
export const chatGPTClientIdSchema = clientId;

/** A transferred source must never refresh, resume or revoke the receiver's session. */
export function assertChatGPTSessionUsable(account: ChatGPTAccount | undefined) {
  if (account?.transfer && account.transfer.state !== 'received')
    throw new ChatGPTError('session_transferred_use_hosted_broker');
}

function privateEntry(info: Stats, directory: boolean) {
  if (
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) ||
    (process.getuid && info.uid !== process.getuid()) ||
    info.mode & 0o077
  )
    throw new ChatGPTError('unsafe_credential_storage');
}

/** Protect every component below the supplied operator-owned parent. No symlink traversal. */
function privateDirectory(path: string, create: boolean) {
  if (process.platform === 'win32') throw new ChatGPTError('unix_permissions_required');
  const parent = dirname(path);
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new ChatGPTError('unsafe_credential_storage');
    privateEntry(info, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return false;
    // The immediate parent is caller-controlled, but must itself be a real directory.
    const info = lstatSync(parent);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ChatGPTError('unsafe_credential_storage');
    mkdirSync(path, { mode: 0o700 });
  }
  return true;
}

export class ChatGPTStore {
  readonly directory: string;
  constructor(
    root: string,
    readonly profile = 'default',
  ) {
    if (profile === 'host' || !/^[a-z][a-z0-9-]{0,47}$/.test(profile))
      throw new ChatGPTError('invalid_profile');
    this.directory = resolve(root, '.data', 'chatgpt');
  }
  private path(name: string, create = false) {
    if (
      !privateDirectory(dirname(this.directory), create) ||
      !privateDirectory(this.directory, create)
    )
      return;
    return join(this.directory, name);
  }
  private read<T>(name: string, schema: z.ZodType<T>): T | undefined {
    const path = this.path(name);
    if (!path) return;
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new ChatGPTError('unsafe_credential_storage');
    }
    try {
      const info = fstatSync(fd);
      privateEntry(info, false);
      if (info.size > 96000) throw new ChatGPTError('invalid_credential_record');
      const parsed = schema.safeParse(JSON.parse(readFileSync(fd, 'utf8')));
      if (!parsed.success) throw new ChatGPTError('invalid_credential_record');
      return parsed.data;
    } catch (error) {
      if (error instanceof ChatGPTError) throw error;
      throw new ChatGPTError('invalid_credential_record');
    } finally {
      closeSync(fd);
    }
  }
  private write(name: string, record: unknown) {
    const path = this.path(name, true)!;
    // Refuse an existing unsafe target before atomic replacement.
    try {
      privateEntry(lstatSync(path), false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, JSON.stringify(record) + '\n');
      fsyncSync(fd);
      renameSync(temporary, path);
      const directoryFd = openSync(this.directory, constants.O_RDONLY);
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } finally {
      closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  /** Cross-process exclusion; stale locks fail closed, never steal a rotating session. */
  async exclusive<T>(operation: () => Promise<T>, name = this.profile): Promise<T> {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new ChatGPTError('invalid_profile');
    const path = this.path(`${name}.lock`, true)!;
    let fd: number;
    try {
      fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      throw new ChatGPTError('session_busy_check_lock_after_crash');
    }
    try {
      return await operation();
    } finally {
      closeSync(fd);
      unlinkSync(path);
    }
  }
  load() {
    return this.read(`${this.profile}.json`, chatGPTAccountSchema);
  }
  save(account: ChatGPTAccount) {
    const parsed = chatGPTAccountSchema.safeParse(account);
    if (!parsed.success) throw new ChatGPTError('invalid_credential_record');
    this.write(`${this.profile}.json`, parsed.data);
  }
  async hostId(): Promise<string> {
    return this.exclusive(async () => {
      const schema = z.object({ id: z.string().uuid() }).strict();
      let host = this.read('host.json', schema);
      if (!host) {
        host = { id: randomUUID() };
        this.write('host.json', host);
      }
      return `urn:uuid:${host.id}`;
    }, 'host');
  }
}
