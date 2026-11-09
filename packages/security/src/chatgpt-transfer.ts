import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ChatGPTError,
  ChatGPTStore,
  chatGPTAccountSchema,
  type ChatGPTAccount,
} from './chatgpt-store';

export const CHATGPT_TRANSFER_MAX_BYTES = 100_000;
const profileSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,47}$/)
  .refine((profile) => profile !== 'host');
const ownerSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const destinationSchema = z
  .string()
  .max(200)
  .regex(/^(?:[a-zA-Z_][a-zA-Z0-9_.-]{0,63}@)?[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/);
const containerSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/);
export const chatGPTTransferEnvelopeSchema = z
  .object({
    format: z.literal('elsewhere-chatgpt-session-transfer-v1'),
    transferId: z.string().uuid(),
    ownerUserId: ownerSchema,
    profile: profileSchema,
    // Transfer metadata belongs to the receiver's atomic record, never the supplied account.
    account: chatGPTAccountSchema
      .omit({ transfer: true })
      .refine(
        (account) =>
          Boolean(account.tokens?.refreshToken) &&
          Boolean(account.tokens?.scopes.includes('chatgpt.tokens.use.direct')),
      ),
  })
  .strict();
export const chatGPTTransferAckSchema = z
  .object({
    format: z.literal('elsewhere-chatgpt-session-transfer-ack-v1'),
    transferId: z.string().uuid(),
    ownerUserId: ownerSchema,
    profile: profileSchema,
  })
  .strict();
export type ChatGPTTransferEnvelope = z.infer<typeof chatGPTTransferEnvelopeSchema>;
export type ChatGPTTransferAck = z.infer<typeof chatGPTTransferAckSchema>;
type TransferTransport = (
  destination: string,
  envelope: ChatGPTTransferEnvelope,
  container?: string,
) => Promise<unknown>;

function acknowledgment(envelope: {
  transferId: string;
  ownerUserId: string;
  profile: string;
}): ChatGPTTransferAck {
  return {
    format: 'elsewhere-chatgpt-session-transfer-ack-v1',
    transferId: envelope.transferId,
    ownerUserId: envelope.ownerUserId,
    profile: envelope.profile,
  };
}

/** No token-bearing argv, environment, terminal echo, stderr forwarding or raw output. */
async function sshTransfer(
  destination: string,
  envelope: ChatGPTTransferEnvelope,
  container?: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [
        '-T',
        '-oBatchMode=yes',
        '-oStrictHostKeyChecking=yes',
        '-oConnectTimeout=15',
        ...(process.platform === 'darwin' ? ['-oUseKeychain=yes'] : []),
        '-oForwardAgent=no',
        '-oClearAllForwardings=yes',
        destination,
        ...(container ? ['docker', 'exec', '-i', container] : []),
        'node',
        '/app/dist/inference-operator.mjs',
        'import',
        '--profile',
        envelope.profile,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.fromEntries(
          ['PATH', 'HOME', 'USER', 'LOGNAME', 'SSH_AUTH_SOCK', 'LANG', 'LC_ALL']
            .filter((name) => process.env[name] !== undefined)
            .map((name) => [name, process.env[name]]),
        ),
      },
    );
    let finished = false;
    let output = '';
    const fail = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new ChatGPTError('transfer_unconfirmed_source_disabled'));
    };
    const timer = setTimeout(fail, 60_000);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (data: Buffer) => {
      if (Buffer.byteLength(output) + data.byteLength > 4096) return fail();
      output += data.toString('utf8');
    });
    child.stderr.resume();
    child.on('close', (code) => {
      if (finished) return;
      if (code !== 0) return fail();
      try {
        const result: unknown = JSON.parse(output);
        finished = true;
        clearTimeout(timer);
        resolve(result);
      } catch {
        fail();
      }
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}

/**
 * Disable the source durably BEFORE sending. Unknown outcomes stay pending and can only
 * retry the same destination/owner/transfer ID; they never restore local token use.
 */
export async function transferChatGPTSession(
  store: ChatGPTStore,
  options: {
    destination: string;
    ownerUserId: string;
    container?: string;
    transport?: TransferTransport;
  },
): Promise<ChatGPTTransferAck> {
  if (
    !destinationSchema.safeParse(options.destination).success ||
    !ownerSchema.safeParse(options.ownerUserId).success ||
    (options.container !== undefined && !containerSchema.safeParse(options.container).success)
  )
    throw new ChatGPTError('invalid_transfer_destination_or_owner');
  return store.exclusive(async () => {
    const account = store.load();
    if (!account) throw new ChatGPTError('sign_in_required');
    const previous = account.transfer;
    if (
      previous &&
      (previous.state === 'received' ||
        previous.ownerUserId !== options.ownerUserId ||
        previous.container !== options.container ||
        previous.destination !== options.destination)
    )
      throw new ChatGPTError('transfer_binding_mismatch');
    const transferId = previous?.id ?? randomUUID();
    const expected = acknowledgment({
      transferId,
      ownerUserId: options.ownerUserId,
      profile: store.profile,
    });
    if (previous?.state === 'delegated') return expected;
    const { transfer: _sourceTransfer, ...credentials } = account;
    const parsed = chatGPTTransferEnvelopeSchema.safeParse({
      format: 'elsewhere-chatgpt-session-transfer-v1',
      transferId,
      ownerUserId: options.ownerUserId,
      profile: store.profile,
      account: credentials,
    });
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(parsed.data)) > CHATGPT_TRANSFER_MAX_BYTES
    )
      throw new ChatGPTError('transfer_requires_renewable_plan_session');
    const pending: ChatGPTAccount = {
      ...account,
      transfer: {
        id: transferId,
        state: 'pending',
        ownerUserId: options.ownerUserId,
        destination: options.destination,
        ...(options.container ? { container: options.container } : {}),
      },
    };
    store.save(pending);
    try {
      const received = chatGPTTransferAckSchema.safeParse(
        await (options.transport ?? sshTransfer)(
          options.destination,
          parsed.data,
          options.container,
        ),
      );
      if (!received.success || JSON.stringify(received.data) !== JSON.stringify(expected))
        throw new ChatGPTError('transfer_acknowledgment_mismatch');
      store.save({
        ...pending,
        tokens: undefined,
        transfer: { ...pending.transfer!, state: 'delegated' },
      });
      return received.data;
    } catch {
      throw new ChatGPTError('transfer_unconfirmed_source_disabled');
    }
  });
}

/** Trusted broker-only operation. Does not access or reset inference allowances. */
export async function importChatGPTTransfer(
  store: ChatGPTStore,
  input: unknown,
  expectedOwnerUserId: string,
): Promise<ChatGPTTransferAck> {
  const parsed = chatGPTTransferEnvelopeSchema.safeParse(input);
  if (
    !parsed.success ||
    !ownerSchema.safeParse(expectedOwnerUserId).success ||
    parsed.data.ownerUserId !== expectedOwnerUserId ||
    parsed.data.profile !== store.profile
  )
    throw new ChatGPTError('transfer_binding_mismatch');
  const envelope = parsed.data;
  // Preserve/create the receiver's own host identity. A laptop host ID is never accepted.
  await store.hostId();
  return store.exclusive(async () => {
    const existing = store.load();
    if (existing) {
      if (
        existing.transfer?.state !== 'received' ||
        existing.transfer.id !== envelope.transferId ||
        existing.transfer.ownerUserId !== expectedOwnerUserId ||
        existing.clientId !== envelope.account.clientId ||
        existing.subject !== envelope.account.subject ||
        existing.issuer !== envelope.account.issuer
      )
        throw new ChatGPTError('transfer_destination_already_provisioned');
      // A lost ACK may be retried after refresh or logout: never overwrite receiver tokens.
      return acknowledgment(envelope);
    }
    store.save({
      ...envelope.account,
      transfer: { id: envelope.transferId, state: 'received', ownerUserId: expectedOwnerUserId },
    });
    return acknowledgment(envelope);
  });
}

/** Explicitly projected status only; safe for an operator terminal. */
export function chatGPTTransferStatus(store: ChatGPTStore) {
  const account = store.load();
  return {
    profile: store.profile,
    credentialsPresent: Boolean(account?.tokens),
    transfer: account?.transfer
      ? {
          id: account.transfer.id,
          state: account.transfer.state,
          ownerUserId: account.transfer.ownerUserId,
        }
      : null,
  };
}
