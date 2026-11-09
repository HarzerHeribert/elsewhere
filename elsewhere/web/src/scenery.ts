import type { PublicWorldState } from '@elsewhere/character-interfaces';

export type VillageScenery = Pick<PublicWorldState, 'bounds' | 'places' | 'obstacles' | 'objects'>;

// Vite supplies the public scenery from the canonical initial layout at build time.
declare const __ELSEWHERE_SCENERY__: VillageScenery;
export const villageScenery = __ELSEWHERE_SCENERY__;

// Moving actors and portable objects update in-place. Rebuild static meshes only if
// their defining layout changes (for example when loading a restored/custom world).
export function staticLayoutKey(world: VillageScenery) {
  const bed = world.objects.find((object) => object.id === 'garden');
  return JSON.stringify([
    world.bounds,
    world.places,
    world.obstacles,
    bed?.position,
    bed?.footprint,
    bed?.height,
    bed?.elevation,
  ]);
}
