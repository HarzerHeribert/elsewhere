import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';

/** Remove only the exact isolated run directory; never the operator's .data tree. */
export default async function teardown(config: Pick<FullConfig, 'metadata'>) {
  const directory: unknown = config.metadata.testDataDirectory;
  if (
    typeof directory !== 'string' ||
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !/^elsewhere-e2e-run-[a-zA-Z0-9-]+$/.test(basename(directory))
  ) {
    throw new Error('Refusing to clean an unrecognized test data directory.');
  }
  if (config.metadata.keepTestData) {
    console.log(`Isolated browser test data retained at ${directory}`);
    return;
  }
  await rm(directory, { recursive: true, force: true });
}
