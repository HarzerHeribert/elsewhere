import type { CharacterCommand, CharacterDecision } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';

export type ScriptedDecision =
  | CharacterDecision
  | CharacterCommand
  | ((
      context: DecisionContext,
    ) => CharacterDecision | CharacterCommand | Promise<CharacterDecision | CharacterCommand>);
export interface ScriptedProvider extends DecisionProvider<CharacterDecision> {
  /** Every context the character showed the provider, in order. */
  contexts: DecisionContext[];
  /** Queue more decisions. */
  push(...decisions: ScriptedDecision[]): void;
  remaining(): number;
}

const isDecision = (value: CharacterDecision | CharacterCommand): value is CharacterDecision =>
  'action' in value;
const normalise = (value: CharacterDecision | CharacterCommand): CharacterDecision =>
  isDecision(value) ? { ...value, why: value.why ?? '' } : { action: value, why: '' };

/**
 * A decision provider that answers from a queue, for tests that drive the character. A bare
 * command is wrapped as a decision without a why. With nothing left it uses `fallback`, or
 * fails loudly so an unscripted decision is never mistaken for behaviour.
 */
export function scriptedProvider(
  script: readonly ScriptedDecision[] = [],
  options: { fallback?: ScriptedDecision; id?: string; managesAllowance?: boolean } = {},
): ScriptedProvider {
  const queue = [...script];
  const contexts: DecisionContext[] = [];
  return {
    id: options.id ?? 'scripted-test-fixture',
    localOnly: true,
    ...(options.managesAllowance === undefined
      ? {}
      : { managesAllowance: options.managesAllowance }),
    contexts,
    push: (...decisions) => void queue.push(...decisions),
    remaining: () => queue.length,
    async propose(context) {
      contexts.push(structuredClone(context));
      const next = queue.length ? queue.shift()! : options.fallback;
      if (next === undefined) throw new Error('The scripted provider has no decision left.');
      return normalise(typeof next === 'function' ? await next(context) : next);
    },
  };
}
