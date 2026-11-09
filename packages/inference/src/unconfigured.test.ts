import { expect, it } from 'vitest';
import { createUnconfiguredInferenceService } from './unconfigured';
it('stays healthy without an owner while exposing no provider dispatch or import path', async () => {
  const token = 'fixture-unbound-private-service-'.repeat(2);
  const service = createUnconfiguredInferenceService(token);
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error();
  const url = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect((await fetch(`${url}/readyz`)).status).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(`${url}/readyz`, { headers })).status).toBe(503);
    expect((await fetch(`${url}/v1/decision`, { method: 'POST', headers })).status).toBe(503);
    expect((await fetch(`${url}/import`, { method: 'POST' })).status).toBe(401);
  } finally {
    await service.close();
  }
});
