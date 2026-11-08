import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import teardown from './e2e/teardown';

it('cleans only an isolated browser run and refuses unrelated data', async () => {
  const run = await mkdtemp(join(tmpdir(), 'elsewhere-e2e-run-'));
  const unrelated = await mkdtemp(join(tmpdir(), 'elsewhere-unrelated-'));
  try {
    await writeFile(join(run, 'test.sqlite'), 'disposable test data');
    await writeFile(join(unrelated, 'keep.txt'), 'keep');
    await expect(teardown({ metadata: { testDataDirectory: unrelated } })).rejects.toThrow(
      /Refusing/,
    );
    await expect(access(join(unrelated, 'keep.txt'))).resolves.toBeUndefined();
    await teardown({ metadata: { testDataDirectory: run } });
    await expect(access(run)).rejects.toThrow();
  } finally {
    await rm(run, { recursive: true, force: true });
    await rm(unrelated, { recursive: true, force: true });
  }
});
