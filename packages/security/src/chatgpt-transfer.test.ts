import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ChatGPTError, ChatGPTStore, type ChatGPTAccount } from './chatgpt-store';
import { beginChatGPTSignIn, ChatGPTSession } from './chatgpt';
import {
  chatGPTTransferStatus,
  importChatGPTTransfer,
  transferChatGPTSession,
  type ChatGPTTransferEnvelope,
} from './chatgpt-transfer';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixtureStore(profile = 'default') {
  const root = mkdtempSync(join(tmpdir(), 'elsewhere-session-transfer-'));
  directories.push(root);
  return { root, store: new ChatGPTStore(root, profile) };
}
function account(): ChatGPTAccount {
  return {
    version: 1,
    issuer: 'https://auth.openai.com',
    clientId: 'oaiapp_fixture',
    subject: 'fixture-subject',
    tokens: {
      accessToken: 'fixture-private-access',
      refreshToken: 'fixture-private-refresh',
      idToken: 'fixture-private-id',
      expiresAt: Date.now() + 3600_000,
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
    },
  };
}
const destination = 'srv-fixture@ssh.frankfurt.render.com';
const ownerUserId = 'fixture-elsewhere-owner';
function envelope(): ChatGPTTransferEnvelope {
  return {
    format: 'elsewhere-chatgpt-session-transfer-v1',
    transferId: randomUUID(),
    ownerUserId,
    profile: 'default',
    account: account(),
  };
}

describe('protected ChatGPT session handoff', () => {
  it('quarantines before sending, preserves a distinct receiver host and clears source tokens after ACK', async () => {
    const local = fixtureStore();
    const remote = fixtureStore();
    const localHost = await local.store.hostId();
    const remoteHost = await remote.store.hostId();
    local.store.save(account());
    const budgetPath = join(remote.root, 'inference-budget.sqlite');
    writeFileSync(budgetPath, 'existing-budget-fixture');
    const transport = vi.fn(async (_destination, payload) => {
      expect(local.store.load()?.transfer?.state).toBe('pending');
      expect(new ChatGPTSession(local.store).isAvailable()).toBe(false);
      expect(payload.account).not.toHaveProperty('transfer');
      return importChatGPTTransfer(remote.store, payload, ownerUserId);
    });
    const ack = await transferChatGPTSession(local.store, { destination, ownerUserId, transport });
    expect(transport).toHaveBeenCalledOnce();
    expect(local.store.load()?.tokens).toBeUndefined();
    expect(local.store.load()?.transfer).toMatchObject({ id: ack.transferId, state: 'delegated' });
    expect(remote.store.load()?.tokens?.refreshToken).toBe('fixture-private-refresh');
    expect(remote.store.load()?.transfer).toMatchObject({ id: ack.transferId, state: 'received' });
    expect(new ChatGPTSession(remote.store).isAvailable()).toBe(true);
    expect(await remote.store.hostId()).toBe(remoteHost);
    expect(remoteHost).not.toBe(localHost);
    expect(readFileSync(budgetPath, 'utf8')).toBe('existing-budget-fixture');
    expect(JSON.stringify(chatGPTTransferStatus(local.store))).not.toContain('fixture-private');
  });

  it('retries an ambiguous transfer with the same ID without restoring already rotated remote tokens', async () => {
    const local = fixtureStore().store;
    const remote = fixtureStore().store;
    const original = account();
    original.tokens!.expiresAt = Date.now() - 1000;
    local.save(original);
    let sent: ChatGPTTransferEnvelope | undefined;
    await expect(
      transferChatGPTSession(local, {
        destination,
        ownerUserId,
        transport: async (_destination, payload) => {
          sent = payload;
          await importChatGPTTransfer(remote, payload, ownerUserId);
          throw new Error('fixture-private-network-body');
        },
      }),
    ).rejects.toThrow('transfer_unconfirmed_source_disabled');
    expect(local.load()?.transfer?.state).toBe('pending');
    expect(local.load()?.tokens?.refreshToken).toBe(original.tokens!.refreshToken);
    const session = new ChatGPTSession(remote, {
      fetcher: async () =>
        Response.json({
          access_token: 'fixture-rotated-access',
          refresh_token: 'fixture-rotated-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct',
        }),
    });
    expect(await session.accessToken()).toBe('fixture-rotated-access');
    expect(remote.load()?.transfer?.id).toBe(sent!.transferId);
    const second = await transferChatGPTSession(local, {
      destination,
      ownerUserId,
      transport: async (_destination, payload) => {
        expect(payload.transferId).toBe(sent!.transferId);
        return importChatGPTTransfer(remote, payload, ownerUserId);
      },
    });
    expect(second.transferId).toBe(sent!.transferId);
    expect(remote.load()?.tokens?.refreshToken).toBe('fixture-rotated-refresh');
    expect(local.load()?.tokens).toBeUndefined();
  });

  it('blocks local inference, refresh, sign-in, resume and revocation while pending or delegated', async () => {
    for (const state of ['pending', 'delegated'] as const) {
      const local = fixtureStore().store;
      local.save({
        ...account(),
        transfer: { id: randomUUID(), state, ownerUserId, destination },
      });
      const fetcher = vi.fn();
      const session = new ChatGPTSession(local, { fetcher });
      expect(session.isAvailable()).toBe(false);
      await expect(session.accessToken()).rejects.toThrow('session_transferred');
      await expect(session.resume()).rejects.toThrow('session_transferred');
      await expect(session.signOut()).rejects.toThrow('session_transferred');
      await expect(beginChatGPTSignIn(session)).rejects.toThrow('session_transferred');
      await session.pauseFor(new ChatGPTError('request_failed'));
      expect(local.load()?.pause).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('rejects different owners, profiles, transfer IDs and existing destination credentials', async () => {
    const remote = fixtureStore().store;
    const input = envelope();
    await expect(importChatGPTTransfer(remote, input, 'another-owner')).rejects.toThrow(
      'binding_mismatch',
    );
    await expect(
      importChatGPTTransfer(remote, { ...input, profile: 'other' }, ownerUserId),
    ).rejects.toThrow('binding_mismatch');
    await expect(
      importChatGPTTransfer(remote, { ...input, hostId: 'copied-laptop' }, ownerUserId),
    ).rejects.toThrow('binding_mismatch');
    remote.save(account());
    await expect(importChatGPTTransfer(remote, input, ownerUserId)).rejects.toThrow(
      'already_provisioned',
    );
    const empty = fixtureStore().store;
    await importChatGPTTransfer(empty, input, ownerUserId);
    await expect(
      importChatGPTTransfer(empty, { ...input, transferId: randomUUID() }, ownerUserId),
    ).rejects.toThrow('already_provisioned');
    await expect(
      importChatGPTTransfer(
        empty,
        { ...input, account: { ...input.account, subject: 'another-subject' } },
        ownerUserId,
      ),
    ).rejects.toThrow('already_provisioned');
  });

  it('never restores a logged-out receiver through retry and does not change the source binding', async () => {
    const remote = fixtureStore().store;
    const input = envelope();
    const ack = await importChatGPTTransfer(remote, input, ownerUserId);
    await new ChatGPTSession(remote, {
      fetcher: async () => new Response(null, { status: 200 }),
    }).signOut();
    expect(await importChatGPTTransfer(remote, input, ownerUserId)).toEqual(ack);
    expect(remote.load()?.tokens).toBeUndefined();
    const local = fixtureStore().store;
    local.save({
      ...account(),
      transfer: { id: input.transferId, state: 'pending', ownerUserId, destination },
    });
    const transport = vi.fn();
    await expect(
      transferChatGPTSession(local, { destination, ownerUserId: 'other-owner', transport }),
    ).rejects.toThrow('binding_mismatch');
    await expect(
      transferChatGPTSession(local, {
        destination: 'srv-other@ssh.frankfurt.render.com',
        ownerUserId,
        transport,
      }),
    ).rejects.toThrow('binding_mismatch');
    expect(transport).not.toHaveBeenCalled();
    expect(local.load()?.transfer?.id).toBe(input.transferId);
  });

  it('rejects unsafe SSH targets and mismatched ACKs without exposing credentials or enabling the source', async () => {
    const local = fixtureStore().store;
    local.save(account());
    const transport = vi.fn();
    for (const invalid of [
      '-oProxyCommand=cat',
      'srv-ok@evil.test',
      'srv-ok@ssh.frankfurt.render.com;cat',
    ])
      await expect(
        transferChatGPTSession(local, { destination: invalid, ownerUserId, transport }),
      ).rejects.toThrow('invalid_transfer');
    expect(local.load()?.transfer).toBeUndefined();
    await expect(
      transferChatGPTSession(local, {
        destination,
        ownerUserId,
        transport: async () => ({ secret: 'fixture-private-access' }),
      }),
    ).rejects.toThrow('transfer_unconfirmed_source_disabled');
    expect(local.load()?.transfer?.state).toBe('pending');
    expect(new ChatGPTSession(local).isAvailable()).toBe(false);
  });

  it('uses pinned non-interactive SSH and transmits tokens only through stdin', async () => {
    vi.stubEnv('MODEL_SECRET', 'fixture-private-environment');
    const local = fixtureStore().store;
    local.save(account());
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    let input = '';
    child.stdin.on('data', (chunk) => {
      input += chunk.toString();
    });
    child.stdin.on('finish', () => {
      const sent: ChatGPTTransferEnvelope = JSON.parse(input);
      child.stdout.write(
        JSON.stringify({
          format: 'elsewhere-chatgpt-session-transfer-ack-v1',
          transferId: sent.transferId,
          ownerUserId,
          profile: sent.profile,
        }),
      );
      child.emit('close', 0);
    });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    await transferChatGPTSession(local, { destination, ownerUserId });
    const args = vi.mocked(spawn).mock.calls[0];
    expect(args[0]).toBe('ssh');
    expect(args[1]).toEqual(
      expect.arrayContaining([
        '-T',
        '-oBatchMode=yes',
        '-oStrictHostKeyChecking=yes',
        destination,
        '/app/dist/inference-operator.mjs',
      ]),
    );
    expect(JSON.stringify(args)).not.toContain('fixture-private');
    expect(args[2]?.env).not.toHaveProperty('MODEL_SECRET');
    expect(input).toContain('fixture-private-refresh');
    expect(local.load()?.tokens).toBeUndefined();
  });
});
