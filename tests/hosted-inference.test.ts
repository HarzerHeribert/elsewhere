import { expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { runtimeProviders } from '../app/providers';
import { appConfig } from '../app/config';
import { hubertInferenceBinding, hubertResourceRegistry } from '../app/residency';
import { createInferenceBroker, type InferenceBrokerState } from '../packages/inference/src/index';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { HUBERT_IDENTITY } from '../characters/hubert/src/persona';

it('runs the real sole-Hubert world through a separate private inference port and fails closed on the wrong owner', async () => {
  const owner = 'fixture-owner';
  const token = 'fixture-private-transport-'.repeat(3);
  const budget = new SqliteSnapshotStore<InferenceBrokerState>(':memory:');
  let dispatches = 0;
  const broker = await createInferenceBroker({
    token,
    binding: hubertInferenceBinding(owner),
    identity: HUBERT_IDENTITY,
    registry: hubertResourceRegistry(owner),
    store: budget,
    maxCallsPerDay: 1,
    decision: async (context) => {
      expect(context.identity).toBe(HUBERT_IDENTITY);
      expect(context.observations).toBeTruthy();
      dispatches++;
      return {
        value: { type: 'reflect' },
        usage: { inputTokens: 123, outputTokens: 17, cachedInputTokens: 100 },
      };
    },
    reflection: async () => {
      throw new Error('Not requested');
    },
  });
  await new Promise<void>((resolve) => broker.server.listen(0, '127.0.0.1', resolve));
  const address = broker.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  const options = {
    MODEL_PROVIDER: 'broker',
    HUBERT_OWNER_USER_ID: owner,
    INFERENCE_BROKER_TOKEN: token,
    INFERENCE_BROKER_URL: `http://127.0.0.1:${address.port}`,
  };
  let controller: ElsewhereController | undefined, wrong: ElsewhereController | undefined;
  try {
    const providers = runtimeProviders(appConfig(options), options, {
      onUsage: (input, output) => controller?.addUsage(input, output),
      budgetFor: () => {
        throw new Error('Routed budget not used');
      },
    });
    controller = await new ElsewhereController(
      new SqliteSnapshotStore<ControllerState>(':memory:'),
      {
        modelProvider: providers.model,
        reflectionProvider: providers.reflection,
        modelMaximum: 2,
      },
    ).init();
    const result = await controller.step();
    expect(dispatches).toBe(1);
    expect(result.runtime.modelStatus).toContain('validated');
    expect(broker.getState().allowance).toMatchObject({
      calls: 1,
      inputTokens: 123,
      outputTokens: 17,
    });
    const wrongOptions = { ...options, HUBERT_OWNER_USER_ID: 'another-owner' };
    const wrongProviders = runtimeProviders(appConfig(wrongOptions), wrongOptions, {
      onUsage: () => undefined,
      budgetFor: () => {
        throw new Error();
      },
    });
    wrong = await new ElsewhereController(new SqliteSnapshotStore<ControllerState>(':memory:'), {
      modelProvider: wrongProviders.model,
    }).init();
    expect((await wrong.step()).runtime.modelStatus).toContain('fallback');
    expect(dispatches).toBe(1);
    expect(broker.getState().allowance.calls).toBe(1);
    expect(wrongProviders.model!.isAvailable!()).toBe(false);
  } finally {
    await wrong?.close();
    await controller?.close();
    await broker.close();
  }
});
