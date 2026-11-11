import 'dotenv/config';
import { runServices } from './processes.mjs';

// Explicit local-only profile; repository defaults and test profiles stay deterministic.
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
await runServices([{ command: executable, args: ['dev'] }], {
  env: {
    ...process.env,
    MODEL_PROVIDER: 'ollama',
    MODEL_NAME: process.env.MODEL_NAME ?? 'qwen3:4b',
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    MODEL_MAX_CALLS_PER_DAY: process.env.MODEL_MAX_CALLS_PER_DAY ?? '1000',
    MODEL_MAX_CALLS_PER_HOUR: process.env.MODEL_MAX_CALLS_PER_HOUR ?? '1000',
    MODEL_TIMEOUT_MS: process.env.MODEL_TIMEOUT_MS ?? '30000',
  },
}).completion;
