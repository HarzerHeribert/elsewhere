import 'dotenv/config';
import { runServices } from './processes.mjs';

// Resolve .env once so the API port and Vite proxy inherit the same configuration.
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
await runServices([
  { command: executable, args: ['dev:server'] },
  { command: executable, args: ['dev:web'] },
]).completion;
