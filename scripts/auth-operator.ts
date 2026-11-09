import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createLocalAuth, authOptionsFromEnvironment } from '../packages/auth/src/index';

/** Private operator command. Neither credential values nor bearer sign-in links go to stdout. */
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { input: { type: 'string' }, output: { type: 'string' } },
  });
  const operation = positionals[0];
  if (
    positionals.length !== 1 ||
    !['create', 'signin'].includes(operation) ||
    !values.input ||
    !values.output
  )
    throw new Error(
      'Use auth:operator create|signin --input <private-identity.json> --output <new-private-signin.json>.',
    );
  const fd = openSync(
    resolve(values.input),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let input: unknown;
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.nlink !== 1 ||
      stat.mode & 0o077 ||
      stat.size > 4096
    )
      throw new Error('Identity input must be an owned private regular file under 4 KB.');
    input = JSON.parse(readFileSync(fd, 'utf8'));
  } finally {
    closeSync(fd);
  }
  const identity =
    operation === 'create'
      ? z
          .object({ email: z.email().max(254), name: z.string().trim().min(1).max(60) })
          .strict()
          .parse(input)
      : z
          .object({ userId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })
          .strict()
          .parse(input);
  // Claim the output path before creating an account or session. Never overwrite a retained link.
  const out = openSync(
    resolve(values.output),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  let auth: Awaited<ReturnType<typeof createLocalAuth>> | undefined;
  try {
    auth = await createLocalAuth(authOptionsFromEnvironment(process.env));
    const userId =
      'email' in identity ? await auth.createOperatorAccount(identity) : identity.userId;
    const link = await auth.issueOperatorSignIn(userId);
    writeFileSync(
      out,
      JSON.stringify({ format: 'elsewhere-operator-signin/v1', userId, ...link }) + '\n',
    );
    fsyncSync(out);
    console.log(
      'Private operator sign-in record written. Email is unverified; character ownership is configured separately.',
    );
  } finally {
    closeSync(out);
    await auth?.close();
  }
}
main().catch(() => {
  console.error(
    'Operator setup failed. Check the private input, a new output path, and the authentication database settings. No values were displayed.',
  );
  process.exitCode = 1;
});
