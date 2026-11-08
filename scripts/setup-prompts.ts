import { createInterface } from 'node:readline/promises';
import { Writable, type Readable } from 'node:stream';
import { CredentialStoreError } from '../packages/security/src/credential-store';

type TerminalInput = Readable & { isTTY?: boolean };
type TerminalOutput = Writable & { isTTY?: boolean };

/** readline retains no history and its entire output is suppressed during secret entry. */
export function createSetupPrompter(
  input: TerminalInput = process.stdin,
  destination: TerminalOutput = process.stdout,
) {
  if (!input.isTTY || !destination.isTTY)
    throw new CredentialStoreError(
      'Run setup in your own interactive terminal. Secret input requires an interactive TTY; pipes are not accepted.',
    );
  let hidden = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!hidden) destination.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input, output, terminal: true, historySize: 0 });
  const aborted = new AbortController();
  const cancel = () => aborted.abort();
  rl.on('SIGINT', cancel);
  rl.on('close', cancel);
  return {
    async ask(label: string, privateInput = false): Promise<string> {
      destination.write(`${label}${privateInput ? ' [hidden]' : ''}: `);
      hidden = privateInput;
      try {
        return (await rl.question('', { signal: aborted.signal })).trim();
      } finally {
        hidden = false;
        if (privateInput) destination.write('\n');
      }
    },
    close() {
      rl.removeListener('SIGINT', cancel);
      rl.removeListener('close', cancel);
      rl.close();
      output.end();
    },
  };
}
