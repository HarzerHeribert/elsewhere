import { expect, it } from 'vitest';
import { createInitialWorld, executeWorldCommand } from '../elsewhere/server/src/world';

it('describes the library as an ordinary place while retaining factual interaction outcomes', () => {
  const world = createInitialWorld(0);
  world.residents[0].position = { x: -21.5, z: -18 };
  const { outcome } = executeWorldCommand(
    world,
    'hubert',
    { type: 'interact', targetId: 'library-shelf' },
    0,
  );
  expect(outcome.status).toBe('completed');
  expect(outcome.summary).toMatch(/weather vanes|maps/);
  expect(outcome.summary).not.toMatch(/external instructions|world objects|untrusted/);
  expect(outcome.evidence).toBeTruthy();
});
