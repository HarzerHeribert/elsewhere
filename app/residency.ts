import { createSoleHubertRegistry } from '../packages/identity/src/index';

/** Current residency policy; future admission is an explicit platform change. */
export function hubertInferenceBinding(ownerUserId: string) {
  return {
    worldId: 'elsewhere',
    characterId: 'hubert' as const,
    ownerUserId,
    connectionId: 'hubert-model',
  };
}
export function hubertResourceRegistry(ownerUserId: string, provider = 'chatgpt') {
  const binding = hubertInferenceBinding(ownerUserId);
  return createSoleHubertRegistry({
    ownerUserId,
    connectionId: binding.connectionId,
    provider,
    worldId: binding.worldId,
  });
}
