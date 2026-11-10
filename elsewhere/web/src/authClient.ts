import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

/** Shared same-origin browser client; provider secrets remain on the server. */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  fetchOptions: { credentials: 'same-origin', timeout: 10000, retry: 0 },
  plugins: [passkeyClient()],
});
