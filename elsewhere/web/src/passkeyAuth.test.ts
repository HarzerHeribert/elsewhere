import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  signIn: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));
vi.mock('better-auth/client', () => ({
  createAuthClient: () => ({
    signIn: { passkey: actions.signIn },
    passkey: {
      addPasskey: actions.add,
      deletePasskey: actions.remove,
      listUserPasskeys: actions.list,
    },
  }),
}));
vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }));
import { browserSupportsPasskeys, listAccountPasskeys, signInWithPasskey } from './passkeyAuth';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const signal = () => new AbortController().signal;

describe('passkey browser boundary', () => {
  it('projects account-only display metadata without exposing credential or attestation data', async () => {
    actions.list.mockResolvedValue({
      data: [
        {
          id: 'passkey-1',
          userId: 'owner-1',
          name: 'My MacBook',
          createdAt: '2026-11-10T00:00:00.000Z',
          publicKey: 'PUBLIC-KEY-CANARY',
          credentialID: 'CREDENTIAL-ID-CANARY',
          aaguid: 'ATTESTATION-CANARY',
        },
      ],
      error: null,
    });
    const passkeys = await listAccountPasskeys('owner-1', signal());
    expect(passkeys).toEqual([
      { id: 'passkey-1', name: 'My MacBook', createdAt: '2026-11-10T00:00:00.000Z' },
    ]);
    expect(JSON.stringify(passkeys)).not.toContain('CANARY');
    await expect(listAccountPasskeys('different-owner', signal())).rejects.toThrow(
      'could not be confirmed for this account',
    );
  });

  it('provides safe cancellation feedback and does not echo unknown server or transport messages', async () => {
    actions.signIn
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'AUTH_CANCELLED', message: 'RAW-CANARY' },
      })
      .mockResolvedValueOnce({ data: null, error: { code: 'UNKNOWN', message: 'RAW-CANARY' } })
      .mockRejectedValueOnce(new Error('RAW-CANARY'));
    await expect(signInWithPasskey(signal())).rejects.toThrow('cancelled');
    await expect(signInWithPasskey(signal())).rejects.toThrow(
      'Try again or use another sign-in method',
    );
    await expect(signInWithPasskey(signal())).rejects.toThrow('request could not be completed');
  });

  it('requires a secure context and the actual browser credential APIs', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('PublicKeyCredential', class {});
    vi.stubGlobal('navigator', { credentials: { create: vi.fn(), get: vi.fn() } });
    expect(browserSupportsPasskeys()).toBe(false);
    vi.stubGlobal('window', { isSecureContext: true });
    expect(browserSupportsPasskeys()).toBe(true);
    vi.stubGlobal('navigator', { credentials: { get: vi.fn() } });
    expect(browserSupportsPasskeys()).toBe(false);
  });
});
