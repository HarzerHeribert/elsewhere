import { expect, it } from 'vitest';
import { narrowActionFormat } from '@elsewhere/character-interfaces';
import type { DecisionContext } from '@elsewhere/character-runtime';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';

const epoch = Date.UTC(2026, 10, 9, 12);
class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expected: number) {
    this.saved = { value: structuredClone(value), version: expected + 1 };
    return expected + 1;
  }
  async close() {}
}

type Property = {
  type?: string;
  const?: string;
  enum?: string[];
  pattern?: string;
  items?: { enum?: string[] };
};
type Alternative = { properties: Record<string, Property>; required: string[] };

/** A stand-in for a provider that enforces the output format but otherwise chooses blindly. */
function formatObedientModel(seed: number) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const chosen = new Map<string, number>();
  return {
    chosen,
    id: 'format-obedient-fixture',
    propose: async (context: DecisionContext) => {
      expect(context.choices?.length).toBeGreaterThan(0);
      const alternative = pick(narrowActionFormat(context.choices).anyOf as Alternative[]);
      const command: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(alternative.properties)) {
        const required = alternative.required.includes(key);
        if (property.const !== undefined) command[key] = property.const;
        else if (property.enum) command[key] = pick(property.enum);
        else if (property.items?.enum) command[key] = [pick(property.items.enum)];
        else if (property.type === 'boolean') command[key] = random() < 0.5;
        else if (required && property.type === 'string' && property.pattern)
          command[key] = 'read'; // An identifier shaped like a control; the world judges the rest.
        else if (required && property.type === 'string')
          command[key] = `a considered line number ${Math.floor(random() * 1000)}`;
        else if (property.type === 'integer') {
          if (required || random() < 0.5) command[key] = 1000 + Math.floor(random() * 120_000);
        } else if (key === 'position')
          command[key] = { x: (random() - 0.5) * 24, z: (random() - 0.5) * 24 };
        // Every identifier the model must supply has to come from an offered list.
        else if (required) throw new Error(`The format left the field ${key} unconstrained.`);
      }
      chosen.set(String(command.type), (chosen.get(String(command.type)) ?? 0) + 1);
      return { action: command, why: '' };
    },
  };
}

/** The live failure: a model that trusts a visible creature's affordance over the offers. */
const affordanceTrustingModel = {
  id: 'affordance-trusting-fixture',
  propose: async (context: DecisionContext) => {
    const creatures = (context.observations.visibleEntities ?? []) as Array<{
      id: string;
      affordances: string[];
    }>;
    const creature = creatures.find((entity) => entity.affordances.includes('inspect'));
    return {
      action: creature ? { type: 'inspect', targetId: creature.id } : { type: 'reflect' },
      why: '',
    };
  },
};

async function live(modelProvider: {
  id: string;
  propose(context: DecisionContext): Promise<unknown>;
}) {
  const controller = await new ElsewhereController(new MemoryStore(), {
    now: () => epoch,
    simulationStepMs: 30_000,
    decisionIntervalMs: 90_000,
    modelMaximum: 100_000,
    modelProvider,
  }).init();
  const declined: string[] = [];
  try {
    for (let turn = 0; turn < 200; turn++) {
      await controller.step();
      for (const issue of controller.getCharacterIssues())
        if (!issue.resolvedAt && issue.kind === 'invalid') declined.push(`${turn}:${issue.code}`);
    }
    return { declined, snapshot: controller.getSnapshot() };
  } finally {
    await controller.close();
  }
}

it.each([7, 2026])(
  'never declines a reply that obeys the turn format across a long lived life (seed %i)',
  async (seed) => {
    const model = formatObedientModel(seed);
    const { declined, snapshot } = await live(model);
    expect(declined).toEqual([]);
    expect(snapshot.runtime.modelStatus).toBe('Model connected');
    // The run really exercised the spatial vocabulary rather than idling.
    for (const type of ['move', 'look', 'inspect', 'interact', 'rest', 'reflect'])
      expect(model.chosen.get(type) ?? 0, type).toBeGreaterThan(0);
  },
  30_000,
);

it('would decline affordance-trusting replies in the same world, which is what choices prevent', async () => {
  const { declined } = await live(affordanceTrustingModel);
  expect(declined.some((entry) => entry.endsWith('unavailable_action'))).toBe(true);
  expect(declined.some((entry) => entry.endsWith('invalid_action'))).toBe(false);
}, 30_000);
