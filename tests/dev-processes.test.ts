import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

type Receipt = {
  event: 'ready' | 'sigterm' | 'cleanup' | 'exit' | 'double-signal';
  service: string;
  role: 'service' | 'descendant';
  pid: number;
  port: string;
  webPort: string;
};

const launcher = fileURLToPath(new URL('../scripts/dev.mjs', import.meta.url));
const processes = new URL('../scripts/processes.mjs', import.meta.url).href;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function running(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Launcher did not finish shutdown')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

it.skipIf(process.platform === 'win32').each([
  {
    name: 'loads root dotenv and forwards one graceful termination through each service tree',
    mode: 'graceful',
  },
  {
    name: 'waits for and force-cleans owned descendants after their supervisor exits',
    mode: 'orphan',
  },
])(
  '$name',
  async ({ mode }) => {
    const directory = await mkdtemp(join(tmpdir(), 'elsewhere-launcher-test-'));
    const receiptFile = join(directory, 'receipts.jsonl');
    let child: ReturnType<typeof spawn> | undefined;
    let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    const observed = new Map<number, Receipt>();
    let output = '';
    async function receipts(): Promise<Receipt[]> {
      const contents = await readFile(receiptFile, 'utf8');
      const entries = contents
        .split('\n')
        .slice(0, -1)
        .map((line) => JSON.parse(line) as Receipt);
      for (const entry of entries) observed.set(entry.pid, entry);
      return entries;
    }
    async function waitForReady() {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const entries = await receipts();
        if (entries.filter((entry) => entry.event === 'ready').length === 4) return entries;
        if (child?.exitCode !== null || child?.signalCode !== null)
          throw new Error(`Launcher exited before readiness: ${output}`);
        await delay(20);
      }
      throw new Error(`Stub services did not become ready: ${output}`);
    }
    try {
      await writeFile(receiptFile, '');
      await writeFile(join(directory, '.env'), 'PORT=43127\nVITE_PORT=53127\n');
      // These are owned process fixtures, not API/web servers. Every process records its
      // termination and waits longer than the former launcher's 350 ms forced exit.
      await writeFile(
        join(directory, 'pnpm'),
        `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const service = process.argv[2];
const role = process.argv[3] || 'service';
const record = event => appendFileSync(process.env.TEST_LAUNCHER_RECEIPTS, JSON.stringify({
  event, service, role, pid: process.pid, port: process.env.PORT, webPort: process.env.VITE_PORT,
}) + '\\n');
let descendantClosed = role === 'descendant';
let descendant;
let cleaned = false;
let stopping = false;
const keepAlive = setInterval(() => {}, 1000);
function finish() {
  if (!cleaned || !descendantClosed) return;
  record('exit');
  clearInterval(keepAlive);
  process.exit(0);
}
process.on('SIGTERM', () => {
  if (stopping) { record('double-signal'); process.exit(23); }
  stopping = true;
  record('sigterm');
  if (role === 'service' && process.env.TEST_LAUNCHER_MODE === 'orphan') {
    record('exit');
    process.exit(0);
  }
  // A real pnpm supervisor forwards the signal; its descendant must receive it once.
  // Delay forwarding briefly so an incorrect group signal cannot coalesce with it.
  if (descendant) setTimeout(() => descendant.kill('SIGTERM'), 50);
  if (process.env.TEST_LAUNCHER_MODE === 'orphan') return;
  setTimeout(() => { cleaned = true; record('cleanup'); finish(); }, role === 'service' ? 650 : 850);
});
if (role === 'service') {
  descendant = spawn(process.execPath, [__filename, service, 'descendant'], {
    // The orphan case must close its parent's handles before the descendant exits.
    stdio: process.env.TEST_LAUNCHER_MODE === 'orphan' ? 'ignore' : 'inherit',
  });
  descendant.on('close', () => { descendantClosed = true; finish(); });
}
record('ready');
`,
        { mode: 0o700 },
      );
      const shortGraceLauncher = join(directory, 'short-grace.mjs');
      await writeFile(
        shortGraceLauncher,
        `
import { runServices } from ${JSON.stringify(processes)};
await runServices([
  { command: 'pnpm', args: ['dev:server'] },
  { command: 'pnpm', args: ['dev:web'] },
], { graceMs: 300 }).completion;
`,
      );
      child = spawn(process.execPath, [mode === 'graceful' ? launcher : shortGraceLauncher], {
        cwd: directory,
        detached: true,
        env: {
          PATH: [directory, dirname(process.execPath), process.env.PATH]
            .filter(Boolean)
            .join(delimiter),
          NODE_ENV: 'test',
          TEST_LAUNCHER_RECEIPTS: receiptFile,
          TEST_LAUNCHER_MODE: mode,
          // The real launcher above must discover dotenv; the short-grace runner
          // exercises shutdown alone, without importing any app configuration.
          ...(mode === 'orphan' ? { PORT: '43127', VITE_PORT: '53127' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.on('error', (error) => {
        output += error.message;
      });
      closed = new Promise((resolve) =>
        child!.once('close', (code, signal) => resolve({ code, signal })),
      );
      const ready = (await waitForReady()).filter((entry) => entry.event === 'ready');
      expect(ready.map((entry) => `${entry.service}/${entry.role}`).sort()).toEqual([
        'dev:server/descendant',
        'dev:server/service',
        'dev:web/descendant',
        'dev:web/service',
      ]);
      for (const entry of ready)
        expect({ port: entry.port, webPort: entry.webPort }).toEqual({
          port: '43127',
          webPort: '53127',
        });
      child.kill('SIGTERM');
      expect(await within(closed, 5000), output).toEqual({ code: 0, signal: null });
      const finished = await receipts();
      for (const entry of ready) {
        expect(
          finished.filter((receipt) => receipt.pid === entry.pid).map((receipt) => receipt.event),
        ).toEqual(
          mode === 'graceful'
            ? ['ready', 'sigterm', 'cleanup', 'exit']
            : entry.role === 'service'
              ? ['ready', 'sigterm', 'exit']
              : ['ready'],
        );
        expect(running(entry.pid), `${entry.service}/${entry.role} must be reaped`).toBe(false);
        if (entry.role === 'service')
          expect(running(-entry.pid), 'The owned process group must be gone').toBe(false);
      }
    } finally {
      // Give normal cleanup a chance after a failed assertion, then kill only the
      // process groups/PIDs this fixture created so failed tests cannot leak them.
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (closed) await within(closed, 2500).catch(() => {});
      await receipts().catch(() => []);
      for (const entry of observed.values()) {
        try {
          process.kill(entry.role === 'service' ? -entry.pid : entry.pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
      if (child?.pid && child.exitCode === null && child.signalCode === null)
        process.kill(-child.pid, 'SIGKILL');
      if (closed) await within(closed, 2500);
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
