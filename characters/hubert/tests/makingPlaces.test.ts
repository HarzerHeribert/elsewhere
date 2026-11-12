import { describe, expect, it } from 'vitest';
import { createInitialWorld, observeWorld } from '../../../elsewhere/server/src/world';
import { createInitialHubert } from '../src/index';
import { atMakingPlace, hubertActionOffers } from '../src/actionOffers';

const noon = Date.UTC(2026, 10, 9, 12);

function standingAt(id: string) {
  const world = createInitialWorld(noon);
  const object = world.objects.find((item) => item.id === id)!;
  world.residents[0].position = {
    x: object.position.x,
    z: object.position.z + object.radius + 0.4,
  };
  world.residents[0].facing = Math.PI;
  const state = createInitialHubert(noon);
  const observation = observeWorld(world, 'hubert');
  return { world, state, observation };
}

describe('places for making and the controls of working objects', () => {
  for (const id of ['reading-table', 'easel']) {
    it(`offers make at the ${id} only when a studio is configured`, () => {
      const { state, observation } = standingAt(id);
      const offer = (studio: boolean) =>
        hubertActionOffers(state, observation, noon, undefined, studio).find(
          (item) => item.id === id,
        )!;
      expect(offer(true).ready).toContain('make');
      expect(offer(false).ready).not.toContain('make');
      expect(offer(true).ready).not.toContain('work');
      expect(atMakingPlace(observation)).toBe(true);
    });
  }

  it('offers every control of each working object in reach', () => {
    for (const id of [
      'windchime',
      'standing-stones',
      'sundial',
      'lookout-telescope',
      'pond-water',
      'weather-marker',
      'garden',
      'orchard-tree',
      'window',
      'easel',
      'pinned-music-box',
      'launch-stand',
      'specimen-tray',
      'seed-drawers',
    ]) {
      const { world, state, observation } = standingAt(id);
      world.obstacles = [];
      const publicObject = observeWorld(world, 'hubert').visibleObjects.find(
        (item) => item.id === id,
      );
      const seen = publicObject ?? observation.visibleObjects.find((item) => item.id === id);
      expect(seen, id).toBeTruthy();
      const offer = hubertActionOffers(state, observeWorld(world, 'hubert'), noon).find(
        (item) => item.id === id,
      )!;
      expect(
        offer.controls?.map((c) => c.id),
        id,
      ).toEqual(seen!.controls!.map((c) => c.id));
      expect(offer.controls!.length, id).toBeGreaterThanOrEqual(2);
      expect(offer.ready, id).toContain('use');
    }
  });
});
