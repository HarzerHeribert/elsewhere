import 'dotenv/config';
import { authOptionsFromEnvironment, createLocalAuth } from '../packages/auth/src/index';
const id = process.argv[2];
if (!id) {
  console.error(
    'Usage: pnpm auth:admin <user-id> [--revoke]\nFind your own user ID in the Account window after signing up. This is a trusted local operator command.',
  );
  process.exit(1);
}
const auth = await createLocalAuth(authOptionsFromEnvironment(process.env));
try {
  await auth.setWorldAdmin(id, !process.argv.includes('--revoke'));
  console.log(
    process.argv.includes('--revoke')
      ? 'World admin role revoked.'
      : 'World admin role granted. It grants no wallet or billing access.',
  );
} finally {
  await auth.close();
}
