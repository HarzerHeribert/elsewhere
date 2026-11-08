import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { createSetupPrompter } from '../scripts/setup-prompts';

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (_raw: boolean) => input,
  });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  return { input, output, rendered: () => rendered };
}

it('suppresses a secret through real readline terminal editing, then restores ordinary prompts', async () => {
  const tty = terminal();
  const prompt = createSetupPrompter(tty.input, tty.output);
  try {
    const answer = prompt.ask('Provider key', true);
    tty.input.write('fixture-private-DO-NOT-ECHO\r');
    expect(await answer).toBe('fixture-private-DO-NOT-ECHO');
    expect(tty.rendered()).toContain('Provider key [hidden]');
    expect(tty.rendered()).not.toContain('fixture');
    expect(tty.rendered()).not.toContain('DO-NOT-ECHO');
    const next = prompt.ask('Daily limit');
    tty.input.write('20\r');
    expect(await next).toBe('20');
    expect(tty.rendered()).toContain('Daily limit');
    expect(tty.rendered()).toContain('20');
  } finally {
    prompt.close();
  }
});

it('cancels a hidden prompt on Ctrl+C without revealing the unfinished key', async () => {
  const tty = terminal();
  const prompt = createSetupPrompter(tty.input, tty.output);
  try {
    const answer = prompt.ask('API key', true);
    const rejected = expect(answer).rejects.toThrow();
    tty.input.write('fixture-partial-key\x03');
    await rejected;
    expect(tty.rendered()).not.toContain('fixture-partial-key');
  } finally {
    prompt.close();
  }
});

it('refuses secret collection from pipes or captured non-terminal output', () => {
  const tty = terminal();
  expect(() => createSetupPrompter(new PassThrough(), tty.output)).toThrow('interactive terminal');
  expect(() => createSetupPrompter(tty.input, new PassThrough())).toThrow('interactive terminal');
});
