import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runServices } from './processes.mjs';
import { ChatGPTError, ChatGPTStore } from '../packages/security/src/chatgpt-store';
import { ChatGPTSession } from '../packages/security/src/chatgpt';

try {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', default: 'default' },
      model: { type: 'string', default: 'gpt-6-luna' },
      'max-calls': { type: 'string', default: '20' },
    },
  });
  if (
    !/^\d+$/.test(values['max-calls']!) ||
    Number(values['max-calls']) < 1 ||
    Number(values['max-calls']) > 1000
  )
    throw new ChatGPTError('invalid_daily_call_limit');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const session = new ChatGPTSession(new ChatGPTStore(root, values.profile));
  if (!session.isAvailable()) throw new ChatGPTError('sign_in_or_resume_required');
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(MODEL_|CHATGPT_|OPENAI_|INFERENCE_|OLLAMA_|STRIPE_|RESEND_|GH_|GITHUB_|AUTH_|BETTER_AUTH_|DATABASE_URL$|ADMIN_TOKEN$|API_PROXY_SECRET$)/.test(
          key,
        ),
    ),
  );
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  console.log(
    `Owner-only ChatGPT plan runtime: ${values.model}, at most ${values['max-calls']} calls/day shared by decisions and dreams.\nPrivate inputs may be sent to OpenAI. Check the app limit at https://chatgpt.com/settings/usage.`,
  );
  await runServices([
    {
      command,
      args: ['dev:server'],
      env: {
        ...inherited,
        MODEL_PROVIDER: 'chatgpt',
        MODEL_NAME: values.model,
        MODEL_MAX_CALLS_PER_DAY: values['max-calls'],
        MODEL_TIMEOUT_MS: '30000',
        CHATGPT_PROFILE: values.profile,
        CHATGPT_AUTH_ROOT: root,
      },
    },
    { command, args: ['dev:web'], env: inherited },
  ]).completion;
} catch (error) {
  console.error(
    error instanceof ChatGPTError
      ? error.message
      : 'ChatGPT launch failed; no credentials were displayed.',
  );
  process.exitCode = 1;
}
