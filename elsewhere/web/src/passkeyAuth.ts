import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

// Same-origin cookies are the credential. A successful ceremony is followed by /api/account.
const client = createAuthClient({
  basePath: '/api/auth',
  fetchOptions: { credentials: 'same-origin', timeout: 10000, retry: 0 },
  plugins: [passkeyClient()],
});

export interface AccountPasskey {
  id: string;
  name: string;
  createdAt?: string;
}

export function browserSupportsPasskeys() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function'
  );
}

function accepted(
  result: { data: unknown; error: unknown },
  operation: 'signin' | 'add' | 'remove' | 'list',
) {
  if (!result.error && result.data) return;
  const error = result.error as { code?: string; status?: number } | undefined;
  if (error?.status === 401 && operation !== 'signin')
    throw new Error('Sign in again before managing your passkeys.');
  if (error?.status === 403 && operation !== 'signin')
    throw new Error('Verify your passkey again before managing account security.');
  if (error?.status === 429) throw new Error('Please wait before trying your passkey again.');
  if (error?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
    throw new Error('That passkey is already registered. You can use it to sign in.');
  if (['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED'].includes(error?.code ?? ''))
    throw new Error('The passkey request was cancelled. You can try again.');
  throw new Error(
    operation === 'signin'
      ? 'The passkey could not sign you in. Try again or use another sign-in method.'
      : operation === 'add'
        ? 'The passkey could not be added. Please try again.'
        : operation === 'remove'
          ? 'The passkey could not be removed. Please try again.'
          : 'Your passkeys could not be loaded. Please try again.',
  );
}

async function passkeyRequest<T>(
  operation: 'signin' | 'add' | 'remove' | 'list',
  work: () => Promise<{ data: T | null; error: unknown }>,
): Promise<T> {
  let result;
  try {
    result = await work();
  } catch {
    throw new Error('The passkey request could not be completed. Please try again.');
  }
  accepted(result, operation);
  return result.data!;
}

export async function signInWithPasskey(signal: AbortSignal) {
  await passkeyRequest('signin', () => client.signIn.passkey({ fetchOptions: { signal } }));
}

export async function addAccountPasskey(name: string, signal: AbortSignal) {
  await passkeyRequest('add', () => client.passkey.addPasskey({ name, fetchOptions: { signal } }));
}

export async function removeAccountPasskey(id: string, signal: AbortSignal) {
  await passkeyRequest('remove', () =>
    client.passkey.deletePasskey({ id, fetchOptions: { signal } }),
  );
}

/** Only display metadata for this account, never credential IDs, public keys or attestation data. */
export async function listAccountPasskeys(
  userId: string,
  signal: AbortSignal,
): Promise<AccountPasskey[]> {
  const result = await passkeyRequest('list', () =>
    client.passkey.listUserPasskeys({ fetchOptions: { signal } }),
  );
  if (!Array.isArray(result) || result.length > 100)
    throw new Error('The passkey list could not be read. Please try again.');
  return result.map((value) => {
    if (
      value.userId !== userId ||
      typeof value.id !== 'string' ||
      !value.id ||
      value.id.length > 256
    )
      throw new Error('The passkey list could not be confirmed for this account. Sign in again.');
    const createdAt = new Date(String(value.createdAt));
    return {
      id: value.id,
      name:
        typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 100) : 'Passkey',
      ...(Number.isFinite(createdAt.valueOf()) ? { createdAt: createdAt.toISOString() } : {}),
    };
  });
}
