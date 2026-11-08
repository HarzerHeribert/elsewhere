import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { runServices } from './processes.mjs';
import {
  configuredDevelopmentEnvironments,
  CredentialStoreError,
  loadCredentialProfile,
} from '../packages/security/src/credential-store';

try {
  if (process.argv.length > 2)
    throw new CredentialStoreError(
      'This launcher takes no arguments. Configure Hubert with pnpm run setup model.',
    );
  const root = fileURLToPath(new URL('../', import.meta.url));
  const profile = loadCredentialProfile(root, 'hubert', 'model');
  if (!profile)
    throw new CredentialStoreError(
      'No saved Hubert model. Run pnpm run setup model, or use pnpm dev:ollama without a key.',
    );
  const environment = configuredDevelopmentEnvironments(profile.values, process.env);
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  console.log(
    'Explicit cloud-model profile. Only the API receives its saved key. Staged Stripe/email keys stay unused.',
  );
  await runServices([
    { command, args: ['dev:server'], env: environment.api },
    { command, args: ['dev:web'], env: environment.web },
  ]).completion;
} catch (error) {
  console.error(
    error instanceof CredentialStoreError
      ? error.message
      : 'Configured launch failed; no credential values were displayed.',
  );
  process.exitCode = 1;
}
