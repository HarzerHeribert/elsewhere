import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext } from '@elsewhere/character-runtime';
import type { HubertPlanningSummary } from '../../characters/hubert/src/index';
import type { HubertTargetOffer } from '../../characters/hubert/src/actionOffers';

export type BrowserDecisionScenario = 'disabled' | 'memories' | 'birds';

/** Explicit browser-test proposals only. The real host still executes and verifies every action. */
export function browserFixtureAction(
  context: DecisionContext,
  scenario: Exclude<BrowserDecisionScenario, 'disabled'>,
): CharacterCommand {
  const state = context.state as unknown as HubertPlanningSummary;
  const allowed = (action: CharacterCommand) =>
    context.choices?.some(
      (choice) =>
        choice.type === action.type &&
        Object.entries(choice.where ?? {}).every(([field, values]) => {
          const value = (action as Record<string, unknown>)[field];
          return value !== undefined && (values === 'any' || values.includes(String(value)));
        }),
    );
  const propose = (offer: HubertTargetOffer | undefined, type: 'inspect') => {
    if (!offer) return;
    const action: CharacterCommand | undefined = offer.ready.includes(type)
      ? { type, targetId: offer.id }
      : offer.approachFor?.includes(type)
        ? offer.nextAction
        : undefined;
    return action && allowed(action) ? action : undefined;
  };
  const navigate = (targetId: string): CharacterCommand | undefined => {
    const action: CharacterCommand = { type: 'move', targetId };
    return allowed(action) ? action : undefined;
  };
  if (scenario === 'birds') {
    const bird = state.actionOffers.find((offer) => offer.id === 'courtyard-sparrow');
    return propose(bird, 'inspect') ?? navigate('courtyard') ?? { type: 'rest' };
  }
  // Fresh, genuinely encountered objects provide distinct receipts for the memory UI.
  for (const offer of state.actionOffers.filter(
    (offer) => offer.kind === 'object' && !offer.inspections,
  )) {
    const action = propose(offer, 'inspect');
    if (action) return action;
  }
  return { type: 'rest' };
}
