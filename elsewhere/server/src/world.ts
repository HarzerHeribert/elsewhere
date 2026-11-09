import {
  CharacterCommandSchema,
  canonicalWallApertures,
  findWalkPath,
  hasLineOfSight,
  isWalkable as spatialWalkable,
  segmentIsWalkable,
  worldObjectObservationHeight,
  type Bounds,
  type CharacterCommand,
  type Observation,
  type Position,
  type PublicWorldState,
  type WorldEntity,
  type WorldEvent,
  type WorldObject,
  type WorldOutcome,
  type WorldResident,
  type WorldState,
} from '@elsewhere/character-interfaces';
import { advanceEntities, createInitialEntities, publicEntity } from './entities.js';

const SPEED = 0.0022; // world units / millisecond
const MAX_EVENTS = 100;
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: Position, b: Bounds, pad = 0) =>
  p.x >= b.minX + pad && p.x <= b.maxX - pad && p.z >= b.minZ + pad && p.z <= b.maxZ - pad;
const copy = <T>(value: T): T => structuredClone(value);

export function createInitialWorld(now = Date.now()): WorldState {
  const world: WorldState = {
    id: 'elsewhere',
    name: 'Elsewhere',
    version: 1,
    createdAt: now,
    updatedAt: now,
    bounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 8 },
    places: [
      {
        id: 'workshop',
        name: 'The workshop',
        description: 'A sheltered place for experiments and unfinished ideas.',
        bounds: { minX: -9, maxX: -1, minZ: -6, maxZ: 5 },
      },
      {
        id: 'courtyard',
        name: 'The courtyard',
        description: 'An open garden with a bench, a mailbox, and room to wonder.',
        bounds: { minX: -1, maxX: 10, minZ: -8, maxZ: 8 },
      },
    ],
    obstacles: [
      {
        id: 'workshop-west-wall',
        minX: -9.2,
        maxX: -8.8,
        minZ: -6,
        maxZ: 5,
        height: 2.8,
        color: '#d1c4b3',
      },
      {
        id: 'workshop-north-wall',
        minX: -9.2,
        maxX: -0.8,
        minZ: -6.2,
        maxZ: -5.8,
        height: 2.8,
        color: '#d1c4b3',
      },
      {
        id: 'workshop-south-wall',
        minX: -9.2,
        maxX: -0.8,
        minZ: 4.8,
        maxZ: 5.2,
        height: 2.8,
        color: '#d1c4b3',
      },
      {
        id: 'workshop-door-north',
        minX: -1.2,
        maxX: -0.8,
        minZ: -6,
        maxZ: -1.5,
        height: 2.8,
        color: '#d1c4b3',
      },
      {
        id: 'workshop-door-south',
        minX: -1.2,
        maxX: -0.8,
        minZ: 1.5,
        maxZ: 5,
        height: 2.8,
        color: '#d1c4b3',
      },
      { id: 'garden-bed', minX: 5.1, maxX: 7.1, minZ: -4, maxZ: -2, height: 0.5, color: '#8a9770' },
    ],
    objects: [
      {
        id: 'bench',
        name: 'The courtyard bench',
        kind: 'bench',
        description: 'A sun-warmed bench facing the garden.',
        position: { x: 5, z: 4 },
        radius: 1.1,
        height: 0.65,
        color: '#b78d62',
        tags: ['quiet', 'rest', 'courtyard'],
        affordances: ['inspect', 'rest', 'interact'],
        detail:
          'A place to sit and return to an unfinished thought. A small notch marks the left armrest.',
      },
      {
        id: 'workbench',
        name: 'The workbench',
        kind: 'workbench',
        description: 'A wooden table with space for small experiments.',
        position: { x: -6, z: -2 },
        radius: 1.2,
        height: 1,
        color: '#a88462',
        tags: ['making', 'workshop', 'projects'],
        affordances: ['inspect', 'work', 'interact'],
        detail:
          'There are paper scraps, a pencil, and a little mechanical prototype. The table is ready for a new experiment.',
      },
      {
        id: 'window',
        name: 'The workshop window',
        kind: 'window',
        description: 'A bright window with a deep sill.',
        position: { x: -7, z: 2 },
        radius: 0.8,
        height: 1.7,
        color: '#bdd5cd',
        tags: ['light', 'quiet', 'workshop'],
        affordances: ['inspect', 'rest'],
        detail: 'Soft light falls across an empty sill. From here the courtyard sounds distant.',
      },
      {
        id: 'mailbox',
        name: 'The mailbox',
        kind: 'mailbox',
        description: 'A small green mailbox for messages from outside.',
        position: { x: 3, z: -5 },
        radius: 0.5,
        height: 1.2,
        color: '#688477',
        tags: ['messages', 'visitors', 'courtyard'],
        affordances: ['inspect', 'interact'],
        detail:
          'A brass label reads: letters and passing thoughts. The green paint is worn around the little door.',
      },
      {
        id: 'garden',
        name: 'The little garden',
        kind: 'garden',
        description: 'A raised bed of small plants.',
        position: { x: 6.1, z: -3 },
        radius: 1,
        height: 0.5,
        observationHeight: 0.7,
        footprint: { minX: 5.1, maxX: 7.1, minZ: -4, maxZ: -2 },
        color: '#8ba776',
        tags: ['nature', 'patterns', 'courtyard'],
        affordances: ['inspect', 'interact'],
        detail:
          'Three seedlings lean toward the same patch of light. One leaf has an unexpectedly geometric edge.',
      },
      {
        id: 'artifact',
        name: 'An unfamiliar object',
        kind: 'artifact',
        description: 'Something small rests beside the workbench.',
        position: { x: -4.5, z: -2 },
        radius: 0.35,
        elevation: 1.19,
        height: 0.52,
        observationHeight: 1.45,
        color: '#cb8b60',
        tags: ['unfamiliar', 'mechanism', 'workshop'],
        affordances: ['inspect', 'interact'],
        detail:
          'It is a tiny hand-cranked weather vane with a crooked copper fin. Turning the crank makes the fin wobble instead of spin.',
      },
    ],
    residents: [
      {
        id: 'hubert',
        ownerId: 'local-owner',
        name: 'Hubert',
        position: { x: 2, z: 3 },
        facing: 0.8,
        path: [],
        activity: 'idle',
      },
    ],
    events: [
      {
        id: 'world-created',
        at: now,
        type: 'arrival',
        message: 'Hubert arrived in Elsewhere. The courtyard is quiet.',
        characterId: 'hubert',
        placeId: 'courtyard',
      },
    ],
  };
  return expandInitialLayout(world);
}

function expandInitialLayout(world: WorldState): WorldState {
  world.layoutVersion = 3;
  world.spatialVersion = 1;
  world.bounds = { minX: -32, maxX: 32, minZ: -26, maxZ: 26 };
  world.places[1].bounds = { minX: -1, maxX: 11, minZ: -8, maxZ: 9 };
  world.places.push(
    {
      id: 'orchard',
      name: 'The orchard',
      description: 'An old apple grove with a wind chime and a path between the trees.',
      bounds: { minX: -29, maxX: -11, minZ: 8, maxZ: 24 },
    },
    {
      id: 'pond',
      name: 'The pond',
      description: 'Still water, reeds, and a place to watch reflections.',
      bounds: { minX: 11, maxX: 30, minZ: 6, maxZ: 24 },
    },
    {
      id: 'library',
      name: 'The little library',
      description: 'A quiet reading room with maps and books about small mechanisms.',
      bounds: { minX: -29, maxX: -12, minZ: -24, maxZ: -9 },
    },
    {
      id: 'lookout',
      name: 'The lookout',
      description:
        'An open observation point above the meadow, with a telescope pointed at the sky.',
      bounds: { minX: 12, maxX: 30, minZ: -24, maxZ: -10 },
    },
    {
      id: 'meadow',
      name: 'The meadow paths',
      description: 'Open paths connect Elsewhere’s distinct places.',
      bounds: { ...world.bounds },
    },
  );
  world.obstacles.push(
    {
      id: 'pond-water-boundary',
      minX: 16,
      maxX: 24,
      minZ: 10,
      maxZ: 18,
      shape: 'ellipse',
      height: 0.1,
      color: '#7bafa7',
    },
    {
      id: 'orchard-trunk-one',
      minX: -20.55,
      maxX: -19.45,
      minZ: 14.45,
      maxZ: 15.55,
      height: 3.2,
      color: '#8c745a',
    },
    {
      id: 'orchard-trunk-two',
      minX: -25.5,
      maxX: -24.5,
      minZ: 19.5,
      maxZ: 20.5,
      height: 3,
      color: '#8c745a',
    },
    {
      id: 'orchard-trunk-three',
      minX: -15.5,
      maxX: -14.5,
      minZ: 19.5,
      maxZ: 20.5,
      height: 3.5,
      color: '#8c745a',
    },
    {
      id: 'library-west-wall',
      minX: -28.2,
      maxX: -27.8,
      minZ: -23,
      maxZ: -11,
      height: 3,
      color: '#d6c9b8',
    },
    {
      id: 'library-north-wall',
      minX: -28.2,
      maxX: -12.8,
      minZ: -23.2,
      maxZ: -22.8,
      height: 3,
      color: '#d6c9b8',
    },
    {
      id: 'library-south-wall',
      minX: -28.2,
      maxX: -12.8,
      minZ: -11.2,
      maxZ: -10.8,
      height: 3,
      color: '#d6c9b8',
    },
    {
      id: 'library-door-north',
      minX: -13.2,
      maxX: -12.8,
      minZ: -23,
      maxZ: -19,
      height: 3,
      color: '#d6c9b8',
    },
    {
      id: 'library-door-south',
      minX: -13.2,
      maxX: -12.8,
      minZ: -15,
      maxZ: -11,
      height: 3,
      color: '#d6c9b8',
    },
  );
  world.objects.push(
    {
      id: 'orchard-tree',
      name: 'The old apple tree',
      kind: 'tree',
      description: 'A branching tree in the orchard, with uneven fruit and a shaded trunk.',
      position: { x: -20, z: 15 },
      radius: 1.5,
      height: 4.2,
      color: '#77936a',
      tags: ['nature', 'patterns', 'orchard'],
      affordances: ['inspect', 'interact'],
      detail: 'The apples grow in clusters. A fork in the trunk holds a small, empty bird’s nest.',
    },
    {
      id: 'pond-water',
      name: 'The still pond',
      kind: 'pond',
      description: 'A shallow pond reflecting the trees and sky.',
      position: { x: 20, z: 14 },
      radius: 4,
      footprint: { minX: 16, maxX: 24, minZ: 10, maxZ: 18 },
      height: 0.12,
      observationHeight: 0.12,
      color: '#7bafa7',
      tags: ['water', 'patterns', 'quiet'],
      affordances: ['inspect', 'interact'],
      detail:
        'A breeze breaks the reflection into ripples. Three reeds sway out of time with one another.',
    },
    {
      id: 'pond-bench',
      name: 'The pond bench',
      kind: 'bench',
      description: 'A narrow seat overlooking the pond.',
      position: { x: 14, z: 20 },
      radius: 1.1,
      height: 0.65,
      color: '#a48663',
      tags: ['quiet', 'water', 'rest'],
      affordances: ['inspect', 'rest', 'interact'],
      detail: 'From here the water looks like a second, quieter Elsewhere.',
    },
    {
      id: 'library-shelf',
      name: 'The library shelves',
      kind: 'bookshelf',
      description: 'A shelf of maps, field notes and books about mechanisms.',
      position: { x: -23, z: -18 },
      radius: 1.3,
      height: 2.4,
      color: '#98724f',
      tags: ['reading', 'mechanism', 'discovery'],
      affordances: ['inspect', 'interact'],
      detail:
        'One book illustrates weather vanes; another contains maps with several paths left unfinished.',
    },
    {
      id: 'reading-table',
      name: 'The reading table',
      kind: 'table',
      description: 'A broad table beside an open notebook.',
      position: { x: -18, z: -14 },
      radius: 1.2,
      height: 0.9,
      color: '#b08b62',
      tags: ['reading', 'quiet', 'making'],
      affordances: ['inspect', 'interact'],
      detail: 'The notebook contains a simple question: what makes a place worth returning to?',
    },
    {
      id: 'lookout-telescope',
      name: 'The lookout telescope',
      kind: 'telescope',
      description: 'A public brass telescope on a three-legged stand.',
      position: { x: 23, z: -18 },
      radius: 0.8,
      height: 1.6,
      color: '#b7995b',
      tags: ['sky', 'mechanism', 'discovery'],
      affordances: ['inspect', 'interact'],
      detail:
        'The telescope’s focus ring is stiff. Through its lens, a pale moon sits above the edge of the world.',
    },
    {
      id: 'windchime',
      name: 'The orchard wind chime',
      kind: 'windchime',
      description: 'Small copper tubes hung from a wooden frame.',
      position: { x: -12, z: 8 },
      radius: 0.5,
      height: 2,
      color: '#bf956d',
      tags: ['sound', 'patterns', 'nature'],
      affordances: ['inspect', 'interact'],
      detail:
        'Five tubes make an uneven chord when the wind changes. The shortest tube sounds first.',
    },
    {
      id: 'sundial',
      name: 'The courtyard sundial',
      kind: 'sundial',
      description: 'A low stone circle with a copper pointer.',
      position: { x: 9, z: -1 },
      radius: 0.8,
      height: 0.6,
      color: '#bab69f',
      tags: ['time', 'patterns', 'sky'],
      affordances: ['inspect', 'interact'],
      detail:
        'The marks around the dial divide the day into twelve parts. Its shadow offers a second way to notice time passing.',
    },
    {
      id: 'weather-marker',
      name: 'The meadow weather marker',
      kind: 'weather-marker',
      description: 'A simple wind flag beside the path to the lookout.',
      position: { x: 23, z: -8 },
      radius: 0.45,
      height: 2.4,
      color: '#c19a6b',
      tags: ['weather', 'patterns', 'nature'],
      affordances: ['inspect', 'interact'],
      detail:
        'The flag turns with the breeze. Its frayed edge flicks back and forth above the path.',
    },
    {
      id: 'standing-stones',
      name: 'The standing stones',
      kind: 'stones',
      description: 'Three weathered stones beside the orchard path.',
      position: { x: -10, z: 16 },
      radius: 1.2,
      height: 1.7,
      color: '#a9ae9b',
      tags: ['patterns', 'quiet', 'discovery'],
      affordances: ['inspect', 'interact'],
      detail:
        'Two stones lean toward each other; the third stands alone. Their shadows almost meet at the same point.',
    },
  );
  const entryPoints: Record<string, Position> = {
    workshop: { x: -3, z: 0 },
    courtyard: { x: 4, z: 2 },
    orchard: { x: -17, z: 13 },
    pond: { x: 14, z: 16 },
    library: { x: -15, z: -17 },
    lookout: { x: 22, z: -17 },
    meadow: { x: 0, z: 12 },
  };
  for (const place of world.places) place.entryPoint = entryPoints[place.id];
  for (const wall of world.obstacles)
    if (/^(workshop|library)-(.*wall|door-)/.test(wall.id))
      wall.sightApertures = canonicalWallApertures(wall);
  world.entities = createInitialEntities(world.createdAt, world.updatedAt);
  return world;
}

/** Exact canonical authoring corrections; custom operator-authored text is left alone. */
function upgradeCanonicalObjectText(input: WorldState): WorldState {
  const corrections = [
    {
      id: 'mailbox',
      before:
        'A brass label reads: leave a thought, not an instruction. Visitor messages are untrusted suggestions.',
      after:
        'A brass label reads: letters and passing thoughts. The green paint is worn around the little door.',
    },
    {
      id: 'library-shelf',
      before:
        'One book illustrates weather vanes; another contains maps with several paths left unfinished. The books are world objects, not external instructions.',
      after:
        'One book illustrates weather vanes; another contains maps with several paths left unfinished.',
    },
    {
      id: 'lookout-telescope',
      before:
        'The telescope’s focus ring is stiff. Through its simulated lens, a pale moon sits above the edge of the world.',
      after:
        'The telescope’s focus ring is stiff. Through its lens, a pale moon sits above the edge of the world.',
    },
    {
      id: 'weather-marker',
      before:
        'The flag turns with Elsewhere’s simulated breeze. This shared marker is not a personal weather station or an external service.',
      after:
        'The flag turns with the breeze. Its frayed edge flicks back and forth above the path.',
    },
  ];
  if (
    !input.objects.some((object) =>
      corrections.some((entry) => entry.id === object.id && entry.before === object.detail),
    )
  )
    return input;
  const world = copy(input);
  for (const object of world.objects) {
    const correction = corrections.find(
      (entry) => entry.id === object.id && entry.before === object.detail,
    );
    if (correction) object.detail = correction.after;
  }
  world.version++;
  return world;
}

/** Expand the prototype without discarding a resident’s location, history, or creations. */
export function upgradeWorldLayout(input: WorldState): WorldState {
  input = upgradeCanonicalObjectText(input);
  if ((input.layoutVersion ?? 1) >= 3 && (input.spatialVersion ?? 0) >= 1) return input;
  const world = copy(input);
  const template = createInitialWorld(input.createdAt);
  world.layoutVersion = Math.max(3, input.layoutVersion ?? 1);
  if ((input.layoutVersion ?? 1) < 2) {
    // Expand the known prototype without replacing custom places, colliders, or fields.
    world.bounds = {
      minX: Math.min(world.bounds.minX, template.bounds.minX),
      maxX: Math.max(world.bounds.maxX, template.bounds.maxX),
      minZ: Math.min(world.bounds.minZ, template.bounds.minZ),
      maxZ: Math.max(world.bounds.maxZ, template.bounds.maxZ),
    };
    for (const place of template.places) {
      const saved = world.places.find((item) => item.id === place.id);
      if (!saved) world.places.push(copy(place));
      else {
        if (
          place.id === 'courtyard' &&
          sameBounds(saved.bounds, { minX: -1, maxX: 10, minZ: -8, maxZ: 8 })
        )
          saved.bounds = copy(place.bounds);
        if (!saved.entryPoint) saved.entryPoint = copy(place.entryPoint);
      }
    }
    const obstacles = new Set(world.obstacles.map((obstacle) => obstacle.id));
    world.obstacles.push(...template.obstacles.filter((obstacle) => !obstacles.has(obstacle.id)));
    const existing = new Set(world.objects.map((object) => object.id));
    world.objects.push(...template.objects.filter((object) => !existing.has(object.id)));
    for (const resident of world.residents) {
      if (!isWalkable(world, resident.position)) resident.position = { x: 2, z: 3 };
    }
  }
  if ((input.spatialVersion ?? 0) < 1) {
    for (const obstacle of world.obstacles) {
      const canonical = template.obstacles.find((item) => item.id === obstacle.id);
      if (
        !canonical ||
        obstacle.height !== canonical.height ||
        !sameBounds(obstacle, canonical) ||
        (obstacle.shape !== undefined && obstacle.shape !== (canonical.shape ?? 'rectangle'))
      )
        continue;
      if (obstacle.shape === undefined && canonical.shape) obstacle.shape = canonical.shape;
      if (obstacle.sightApertures === undefined && canonical.sightApertures)
        obstacle.sightApertures = copy(canonical.sightApertures);
    }
    for (const object of world.objects) {
      const canonical = template.objects.find((item) => item.id === object.id);
      if (!canonical) continue;
      const obstacleId =
        object.id === 'garden'
          ? 'garden-bed'
          : object.id === 'pond-water'
            ? 'pond-water-boundary'
            : null;
      const obstacle = world.obstacles.find((item) => item.id === obstacleId),
        canonicalObstacle = template.obstacles.find((item) => item.id === obstacleId);
      const originalFootprint =
        obstacle &&
        canonicalObstacle &&
        sameBounds(obstacle, canonicalObstacle) &&
        obstacle.height === canonicalObstacle.height;
      if (
        object.id === 'garden' &&
        originalFootprint &&
        object.position.x === 6 &&
        object.position.z === -3 &&
        object.height === 0.55 &&
        object.footprint === undefined
      ) {
        object.position = copy(canonical.position);
        object.height = canonical.height;
        object.footprint = copy(canonical.footprint);
        object.observationHeight ??= canonical.observationHeight;
      } else if (
        object.id === 'pond-water' &&
        originalFootprint &&
        object.position.x === 20 &&
        object.position.z === 14 &&
        object.radius === 5 &&
        object.height === 0.12 &&
        object.footprint === undefined
      ) {
        object.radius = canonical.radius;
        object.footprint = copy(canonical.footprint);
        object.observationHeight ??= canonical.observationHeight;
      } else if (
        object.id === 'artifact' &&
        object.position.x === -4.5 &&
        object.position.z === -2 &&
        object.height === 0.5 &&
        object.elevation === undefined
      ) {
        object.height = canonical.height;
        object.elevation = canonical.elevation;
        object.observationHeight ??= canonical.observationHeight;
      }
    }
  }
  world.spatialVersion = Math.max(1, input.spatialVersion ?? 0);
  for (const resident of world.residents) {
    let previous = resident.position;
    if (
      resident.path.some((position) => {
        const clear = segmentIsWalkable(world, previous, position);
        previous = position;
        return !clear;
      })
    ) {
      resident.path = [];
      resident.destination = undefined;
      resident.activity = 'idle';
    }
  }
  const existingEntities = new Set(world.entities?.map((entity) => entity.id) ?? []);
  world.entities = [
    ...(world.entities ?? []),
    ...createInitialEntities(world.createdAt, world.updatedAt).filter(
      (entity) => !existingEntities.has(entity.id),
    ),
  ];
  emit(
    world,
    input.updatedAt,
    'world_expanded',
    (input.layoutVersion ?? 1) < 2
      ? 'Paths opened to the orchard, pond, library and lookout. Wildlife has arrived; existing memories and creations remain.'
      : (input.layoutVersion ?? 1) < 3
        ? 'Birds and a butterfly have arrived in Elsewhere. Existing places, residents, memories and creations remain.'
        : 'Shared walking and sight geometry was updated. Existing places, residents, memories and creations remain.',
  );
  return world;
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}

/** Trusted owner-side catalog. No arbitrary code, URLs, secrets, or model-generated tools. */
export function installWishFeature(input: WorldState, objectId: string, now: number): WorldState {
  const presets: Record<string, WorldObject> = {
    telescope: {
      id: 'telescope',
      name: 'Hubert’s telescope',
      kind: 'telescope',
      description: 'A personal telescope installed by the owner at Hubert’s request.',
      position: { x: 21, z: -19 },
      radius: 0.7,
      height: 1.5,
      color: '#b89963',
      tags: ['sky', 'discovery', 'mechanism'],
      affordances: ['inspect', 'interact'],
      detail:
        'A small focus dial adjusts the simulated moon view. This telescope belongs to Hubert’s collection and was installed through an owner-approved world update.',
    },
    'weather-station': {
      id: 'weather-station',
      name: 'Hubert’s weather station',
      kind: 'weather-station',
      description: 'A small instrument station for observing Elsewhere’s simulated weather.',
      position: { x: -4, z: 2 },
      radius: 0.6,
      height: 1.5,
      color: '#8ea69a',
      tags: ['weather', 'patterns', 'making'],
      affordances: ['inspect', 'interact'],
      detail:
        'The station has a wind vane, a rain cup, and a thermometer. It observes simulated world conditions; it does not connect to real-world sensors or a paid API.',
    },
    'painting-kit': {
      id: 'painting-kit',
      name: 'A painting kit',
      kind: 'painting-kit',
      description: 'A box of brushes and colors beside the workbench.',
      position: { x: -6, z: -0.5 },
      radius: 0.45,
      height: 0.3,
      color: '#cb947e',
      tags: ['color', 'making', 'art'],
      affordances: ['inspect', 'interact'],
      detail:
        'Three brushes, six colors, and a blank card provide something new to experiment with. No image-generation service is connected by this update.',
    },
    'magnifying-glass': {
      id: 'magnifying-glass',
      name: 'A magnifying glass',
      kind: 'magnifying-glass',
      description: 'A brass-framed lens for examining small details.',
      position: { x: -4.5, z: -0.5 },
      radius: 0.3,
      height: 0.25,
      color: '#c4ad73',
      tags: ['discovery', 'mechanism', 'patterns'],
      affordances: ['inspect', 'interact'],
      detail:
        'Through the lens, a copper edge looks less smooth than it first appeared. The object supplies a new local observation opportunity.',
    },
    'seed-library': {
      id: 'seed-library',
      name: 'The seed library',
      kind: 'seed-library',
      description: 'A little cabinet of labeled seeds near the orchard.',
      position: { x: -17, z: 11 },
      radius: 0.8,
      height: 1.3,
      color: '#a98e68',
      tags: ['nature', 'patterns', 'making'],
      affordances: ['inspect', 'interact'],
      detail:
        'Paper packets contain sunflower, clover and bean seeds. Their shapes suggest a small classification project.',
    },
    'music-box': {
      id: 'music-box',
      name: 'A mechanical music box',
      kind: 'music-box',
      description: 'A hand-cranked box on the library’s side table.',
      position: { x: -17, z: -15 },
      radius: 0.4,
      height: 0.45,
      color: '#aa8768',
      tags: ['sound', 'mechanism', 'patterns'],
      affordances: ['inspect', 'interact'],
      detail:
        'A cylinder with irregular pins drives a repeating six-note phrase. Turning it slowly makes the mechanism easier to study.',
    },
  };
  if (!Object.hasOwn(presets, objectId))
    throw new Error('That feature is not in the owner-approved local catalog.');
  const world = upgradeWorldLayout(copy(input));
  if (world.objects.some((object) => object.id === objectId))
    throw new Error('That feature is already installed.');
  const object = presets[objectId];
  if (!isWalkable(world, object.position))
    throw new Error('The approved installation position is unavailable.');
  world.objects.push(object);
  emit(
    world,
    now,
    'feature_installed',
    `An owner-approved world update added ${object.name.toLowerCase()}.`,
    { objectId, placeId: placeAt(world, object.position) },
  );
  return world;
}

export function placeAt(world: WorldState, position: Position): string {
  return world.places.find((place) => inside(position, place.bounds))?.id ?? 'courtyard';
}

export function isWalkable(world: WorldState, p: Position): boolean {
  return spatialWalkable(world, p);
}

/** Small authoritative grid pathfinder. Rendering never decides where residents can go. */
export function findPath(world: WorldState, from: Position, to: Position): Position[] | null {
  return findWalkPath(world, from, to);
}

function emit(
  world: WorldState,
  at: number,
  type: string,
  message: string,
  data: Partial<WorldEvent> = {},
): void {
  world.version++;
  world.events.push({ id: `${world.id}:${world.version}:${at}`, at, type, message, ...data });
  world.events = world.events.slice(-MAX_EVENTS);
}

export function advanceWorld(input: WorldState, now: number): WorldState {
  const world = copy(input);
  const elapsed = Math.max(0, Math.min(now - input.updatedAt, 120000));
  world.updatedAt = Math.max(input.updatedAt, now);
  world.entities = advanceEntities(world.entities ?? [], world.createdAt, world.updatedAt);
  for (const resident of world.residents) {
    if (resident.path.length === 0) continue;
    let remaining = elapsed * SPEED;
    while (resident.path.length > 0 && remaining > 0) {
      const next = resident.path[0];
      if (!segmentIsWalkable(world, resident.position, next)) {
        resident.path = [];
        resident.destination = undefined;
        resident.activity = 'idle';
        emit(world, now, 'movement_blocked', `${resident.name}'s path was obstructed.`, {
          characterId: resident.id,
          placeId: placeAt(world, resident.position),
        });
        break;
      }
      const segment = distance(resident.position, next);
      resident.facing = Math.atan2(next.x - resident.position.x, next.z - resident.position.z);
      if (segment <= remaining) {
        resident.position = { ...next };
        resident.path.shift();
        remaining -= segment;
      } else {
        resident.position = {
          x: resident.position.x + ((next.x - resident.position.x) / segment) * remaining,
          z: resident.position.z + ((next.z - resident.position.z) / segment) * remaining,
        };
        remaining = 0;
      }
    }
    if (resident.path.length === 0 && resident.activity === 'walking') {
      resident.destination = undefined;
      resident.activity = 'idle';
      const gazeTarget =
        world.entities?.find((entity) => entity.id === resident.gazeTargetId) ??
        world.objects.find((object) => object.id === resident.gazeTargetId);
      if (gazeTarget)
        resident.facing = Math.atan2(
          gazeTarget.position.x - resident.position.x,
          gazeTarget.position.z - resident.position.z,
        );
      const placeId = placeAt(world, resident.position);
      const placeName =
        world.places.find((place) => place.id === placeId)?.name.toLowerCase() ?? 'Elsewhere';
      emit(world, now, 'arrival', `${resident.name} arrived in ${placeName}.`, {
        characterId: resident.id,
        placeId,
        objectId: resident.gazeTargetId,
      });
    }
  }
  return world;
}

const residentEyeHeight = (resident: WorldResident) =>
  Number.isFinite(resident.eyeHeight) ? Math.max(0.1, Math.min(5, resident.eyeHeight!)) : 1.4;

function lineIsClear(
  world: WorldState,
  a: Position,
  b: Position,
  targetElevation = 1.4,
  eyeHeight = 1.4,
): boolean {
  return hasLineOfSight(world, a, b, targetElevation, eyeHeight);
}

function entityInSight(
  world: WorldState,
  resident: WorldResident,
  entity: WorldEntity,
  range = 10,
  requireFacing = true,
): boolean {
  if (
    distance(resident.position, entity.position) > range ||
    !lineIsClear(
      world,
      resident.position,
      entity.position,
      entity.elevation + entity.height * 0.5,
      residentEyeHeight(resident),
    )
  )
    return false;
  if (!requireFacing) return true;
  const angle = Math.atan2(
    entity.position.x - resident.position.x,
    entity.position.z - resident.position.z,
  );
  const difference = Math.atan2(
    Math.sin(angle - resident.facing),
    Math.cos(angle - resident.facing),
  );
  return Math.abs(difference) <= Math.PI * 0.55;
}

export function observeWorld(
  world: WorldState,
  characterId: string,
  now = world.updatedAt,
): Observation {
  const resident = world.residents.find((r) => r.id === characterId);
  if (!resident) throw new Error('Unknown resident');
  const visibleObjects = world.objects
    .filter((object) => {
      const range = distance(resident.position, object.position);
      if (
        range > 10 ||
        !lineIsClear(
          world,
          resident.position,
          object.position,
          worldObjectObservationHeight(object),
          residentEyeHeight(resident),
        )
      )
        return false;
      if (range <= 1.6) return true;
      const angle = Math.atan2(
        object.position.x - resident.position.x,
        object.position.z - resident.position.z,
      );
      const difference = Math.atan2(
        Math.sin(angle - resident.facing),
        Math.cos(angle - resident.facing),
      );
      return Math.abs(difference) <= Math.PI * 0.55;
    })
    .map(({ detail: _privateDetail, ...object }) => copy(object));
  const placeId = placeAt(world, resident.position);
  const events = world.events
    .filter(
      (e) =>
        e.characterId === characterId || (!e.characterId && (!e.placeId || e.placeId === placeId)),
    )
    .slice(-8);
  const knownPlaces = world.places.map((place) => ({
    id: place.id,
    name: place.name,
    position: copy(
      place.entryPoint ?? {
        x: (place.bounds.minX + place.bounds.maxX) / 2,
        z: (place.bounds.minZ + place.bounds.maxZ) / 2,
      },
    ),
  }));
  const visibleEntities = (world.entities ?? [])
    .filter((entity) => entityInSight(world, resident, entity))
    .map(publicEntity);
  return {
    characterId,
    placeId,
    position: { ...resident.position },
    facing: resident.facing,
    visibleObjects,
    events: copy(events),
    observedAt: now,
    knownPlaces,
    visibleEntities,
  };
}

function entityViewpoint(
  world: WorldState,
  resident: WorldResident,
  entity: WorldEntity,
): Position | null {
  if (entityInSight(world, resident, entity, 7)) return { ...resident.position };
  const candidates: Position[] = [];
  for (const radius of [2, 3.5, 5.5, 7])
    for (let index = 0; index < 16; index++) {
      const angle = (index / 16) * Math.PI * 2;
      const position = {
        x: entity.position.x + Math.sin(angle) * radius,
        z: entity.position.z + Math.cos(angle) * radius,
      };
      if (
        isWalkable(world, position) &&
        lineIsClear(
          world,
          position,
          entity.position,
          entity.elevation + entity.height * 0.5,
          residentEyeHeight(resident),
        )
      )
        candidates.push(position);
    }
  return (
    candidates
      .sort((a, b) => distance(resident.position, a) - distance(resident.position, b))
      .find((position) => findPath(world, resident.position, position) !== null) ?? null
  );
}

function approachPoint(
  world: WorldState,
  resident: WorldResident,
  object: WorldObject,
): Position | null {
  // Already in reach: turning toward the target is enough; avoid a pointless tiny walk.
  const inSight = (position: Position) =>
    lineIsClear(
      world,
      position,
      object.position,
      worldObjectObservationHeight(object),
      residentEyeHeight(resident),
    );
  if (
    distance(resident.position, object.position) <= Math.min(10, object.radius + 1.5) &&
    isWalkable(world, resident.position) &&
    inSight(resident.position)
  )
    return { ...resident.position };
  const candidates = [
    { x: object.position.x, z: object.position.z + object.radius + 0.6 },
    { x: object.position.x + object.radius + 0.6, z: object.position.z },
    { x: object.position.x, z: object.position.z - object.radius - 0.6 },
    { x: object.position.x - object.radius - 0.6, z: object.position.z },
  ];
  return (
    candidates
      .filter((position) => isWalkable(world, position) && inSight(position))
      .sort((a, b) => distance(resident.position, a) - distance(resident.position, b))
      .find((position) => findPath(world, resident.position, position) !== null) ?? null
  );
}

export function executeWorldCommand(
  input: WorldState,
  characterId: string,
  rawCommand: CharacterCommand,
  now = input.updatedAt,
): { world: WorldState; outcome: WorldOutcome } {
  const world = advanceWorld(input, now);
  const result = CharacterCommandSchema.safeParse(rawCommand);
  const resident = world.residents.find((r) => r.id === characterId);
  const outcome: WorldOutcome = {
    id: `outcome:${world.version}:${now}`,
    command: rawCommand,
    status: 'rejected',
    summary: 'Action rejected.',
    at: now,
  };
  if (!resident) {
    outcome.summary = 'Unknown resident.';
    return { world, outcome };
  }
  if (!result.success) {
    outcome.summary = 'Invalid action schema.';
    return { world, outcome };
  }
  const command = result.data;
  const continuingRest = command.type === 'rest' && resident.activity === 'resting';
  outcome.placeId = placeAt(world, resident.position);
  if (command.type === 'move') {
    if (Boolean(command.targetId) === Boolean(command.position)) {
      outcome.summary = 'Choose exactly one destination.';
      return { world, outcome };
    }
    const entity = world.entities?.find((item) => item.id === command.targetId);
    if (entity && !entityInSight(world, resident, entity)) {
      outcome.summary =
        'That entity is not currently visible. Look for it before choosing a viewpoint.';
      return { world, outcome };
    }
    const object = world.objects.find((o) => o.id === command.targetId);
    const place = world.places.find((p) => p.id === command.targetId);
    const destination =
      command.position ??
      (entity
        ? entityViewpoint(world, resident, entity)
        : object
          ? approachPoint(world, resident, object)
          : place
            ? (place.entryPoint ?? {
                x: (place.bounds.minX + place.bounds.maxX) / 2,
                z: (place.bounds.minZ + place.bounds.maxZ) / 2,
              })
            : null);
    if (!destination) {
      outcome.summary = 'That destination is unavailable.';
      return { world, outcome };
    }
    const path = findPath(world, resident.position, destination);
    if (!path) {
      outcome.summary = 'No safe path reaches that destination.';
      return { world, outcome };
    }
    resident.path = path;
    resident.destination = { ...destination };
    resident.gazeTargetId = command.targetId;
    resident.activity = path.length ? 'walking' : 'idle';
    const gazeTarget = entity ?? object;
    if (!path.length && gazeTarget)
      resident.facing = Math.atan2(
        gazeTarget.position.x - resident.position.x,
        gazeTarget.position.z - resident.position.z,
      );
    outcome.status = path.length ? 'started' : 'completed';
    outcome.summary = path.length
      ? entity
        ? `${resident.name} is finding a safe place to watch ${entity.name.toLowerCase()}.`
        : `${resident.name} is walking toward ${object?.name ?? place?.name ?? 'a new spot'}.`
      : `${resident.name} is already at the destination.`;
    outcome.entityId = entity?.id;
    outcome.objectId = object?.id;
    outcome.energyCost = path.length ? 0.8 : 0;
  } else if (
    command.type === 'look' ||
    command.type === 'inspect' ||
    command.type === 'interact' ||
    command.type === 'work'
  ) {
    const entity = world.entities?.find((item) => item.id === command.targetId);
    if (entity) {
      if (
        command.type !== 'look' &&
        (command.type !== 'inspect' || !entity.affordances.includes('inspect'))
      ) {
        outcome.summary =
          'This entity can be watched, not controlled, captured, or used as a work tool.';
        return { world, outcome };
      }
      if (
        !entityInSight(
          world,
          resident,
          entity,
          command.type === 'inspect' ? 8 : 10,
          command.type === 'inspect',
        )
      ) {
        outcome.summary =
          'That entity is outside the current viewing distance, direction, or line of sight.';
        return { world, outcome };
      }
      resident.facing = Math.atan2(
        entity.position.x - resident.position.x,
        entity.position.z - resident.position.z,
      );
      resident.gazeTargetId = entity.id;
      resident.path = [];
      resident.destination = undefined;
      resident.activity = command.type === 'inspect' ? 'watching' : 'looking';
      outcome.status = 'completed';
      outcome.entityId = entity.id;
      outcome.summary =
        command.type === 'inspect'
          ? `${resident.name} watched ${entity.name.toLowerCase()}. It was ${entity.behavior}${entity.species ? ` — ${entity.species.toLowerCase()}` : ''}.`
          : `${resident.name} turned toward ${entity.name.toLowerCase()}.`;
      if (command.type === 'inspect') {
        outcome.encounter = {
          entityId: entity.id,
          kind: entity.kind,
          species: entity.species,
          behavior: entity.behavior,
          observationVersion: entity.observationVersion,
          topics: [...entity.tags],
        };
        outcome.evidence = JSON.stringify({
          source: 'authoritative-world-entity',
          worldId: world.id,
          entityId: entity.id,
          observedAt: world.updatedAt,
          observationVersion: entity.observationVersion,
          species: entity.species,
          behavior: entity.behavior,
          position: entity.position,
          elevation: entity.elevation,
        });
        outcome.energyCost = 0.4;
        outcome.moodDelta = 0.5;
      }
    } else {
      const object = world.objects.find((o) => o.id === command.targetId);
      if (!object) {
        outcome.summary = 'That object does not exist.';
        return { world, outcome };
      }
      if (
        distance(resident.position, object.position) > 10 ||
        !lineIsClear(
          world,
          resident.position,
          object.position,
          worldObjectObservationHeight(object),
          residentEyeHeight(resident),
        )
      ) {
        outcome.summary = 'That object is outside the resident’s line of sight.';
        return { world, outcome };
      }
      if (
        command.type !== 'look' &&
        distance(resident.position, object.position) > object.radius + 1.5
      ) {
        outcome.summary = 'Move closer before interacting with that object.';
        return { world, outcome };
      }
      if (command.type !== 'look' && !object.affordances.includes(command.type)) {
        outcome.summary = 'That object does not support this activity.';
        return { world, outcome };
      }
      resident.facing = Math.atan2(
        object.position.x - resident.position.x,
        object.position.z - resident.position.z,
      );
      resident.gazeTargetId = object.id;
      resident.path = [];
      resident.destination = undefined;
      resident.activity =
        command.type === 'work' ? 'working' : command.type === 'look' ? 'looking' : 'exploring';
      outcome.status = 'completed';
      outcome.objectId = object.id;
      outcome.summary =
        command.type === 'inspect'
          ? `${resident.name} inspected ${object.name.toLowerCase()}. ${object.detail ?? object.description}`
          : command.type === 'work'
            ? `${resident.name} sketched a working idea at the workbench: a small weather-vane experiment.`
            : command.type === 'interact'
              ? `${resident.name} spent a moment with ${object.name.toLowerCase()}. ${object.detail ?? object.description}`
              : `${resident.name} turned toward ${object.name.toLowerCase()}.`;
      if (command.type === 'work') {
        const sketch = world.objects.find((item) => item.id === 'weather-vane-sketch');
        if (!sketch)
          world.objects.push({
            id: 'weather-vane-sketch',
            name: 'A weather-vane sketch',
            kind: 'sketch',
            description: 'A little diagram Hubert made while investigating the copper mechanism.',
            position: { x: -6.7, z: -1.9 },
            radius: 0.25,
            height: 1.04,
            color: '#eee2bd',
            tags: ['making', 'mechanism', 'weather', 'workshop'],
            affordances: ['inspect'],
            detail:
              'Hubert’s sketch shows a crank, an axle and a copper fin. A pencilled question asks whether the bent fin rubs against the axle housing. Beside it is a proposed experiment: straighten the fin and compare three rotations.',
          });
        else
          sketch.detail = `${sketch.detail?.split(' Revision noted at')[0]} Revision noted at ${new Date(now).toISOString()}: check the fin clearance before changing the crank.`;
        object.description =
          'A wooden table with Hubert’s weather-vane sketch beside the unfinished mechanism.';
      }
      outcome.evidence =
        command.type === 'work'
          ? 'A weather-vane experiment is sketched on paper at the workbench.'
          : command.type === 'inspect' || command.type === 'interact'
            ? (object.detail ?? object.description)
            : undefined;
      outcome.energyCost = command.type === 'work' ? 5 : command.type === 'inspect' ? 1 : 0.3;
      outcome.moodDelta = command.type === 'work' ? 2 : command.type === 'inspect' ? 1 : 0.3;
    }
  } else if (command.type === 'rest') {
    resident.activity = 'resting';
    resident.path = [];
    resident.destination = undefined;
    outcome.status = 'completed';
    outcome.summary = continuingRest
      ? `${resident.name} continued resting.`
      : `${resident.name} settled down to rest.`;
  } else if (command.type === 'reflect') {
    resident.activity = 'reflecting';
    outcome.status = 'completed';
    outcome.summary = `${resident.name} paused to consider recent experiences.`;
  } else if (command.type === 'say') {
    resident.activity = 'talking';
    outcome.status = 'completed';
    outcome.summary = `${resident.name}: ${command.text}`;
    outcome.energyCost = 0.3;
  } else if (command.type === 'delegate') {
    outcome.summary = 'External delegation is disabled in local mode. No worker was started.';
  }
  if (outcome.status !== 'rejected' && !continuingRest)
    emit(world, now, outcome.encounter ? 'entity_observed' : command.type, outcome.summary, {
      characterId,
      objectId: outcome.objectId,
      entityId: outcome.entityId,
      placeId: outcome.placeId,
    });
  outcome.id = outcome.encounter ? world.events.at(-1)!.id : `outcome:${world.version}:${now}`;
  return { world, outcome };
}

export function publicWorld(world: WorldState): PublicWorldState {
  const bounds = ({ minX, maxX, minZ, maxZ }: Bounds): Bounds => ({ minX, maxX, minZ, maxZ });
  return {
    id: world.id,
    name: world.name,
    version: world.version,
    layoutVersion: world.layoutVersion,
    spatialVersion: world.spatialVersion,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    bounds: bounds(world.bounds),
    places: world.places.map(({ id, name, description, bounds: area, entryPoint }) => ({
      id,
      name,
      description,
      bounds: bounds(area),
      entryPoint: entryPoint ? { ...entryPoint } : undefined,
    })),
    objects: world.objects.map(
      ({
        id,
        name,
        kind,
        description,
        position,
        radius,
        height,
        color,
        tags,
        affordances,
        elevation,
        observationHeight,
        footprint,
      }) => ({
        id,
        name,
        kind,
        description,
        position: { ...position },
        radius,
        height,
        color,
        tags: [...tags],
        affordances: [...affordances],
        elevation,
        observationHeight,
        footprint: footprint ? bounds(footprint) : undefined,
      }),
    ),
    obstacles: world.obstacles.map(
      ({ id, minX, maxX, minZ, maxZ, height, color, shape, sightApertures }) => ({
        id,
        minX,
        maxX,
        minZ,
        maxZ,
        height,
        color,
        shape,
        sightApertures: sightApertures?.map(({ minX, maxX, minZ, maxZ, minY, maxY }) => ({
          minX,
          maxX,
          minZ,
          maxZ,
          minY,
          maxY,
        })),
      }),
    ),
    residents: world.residents.map(
      ({
        id,
        ownerId,
        name,
        position,
        facing,
        path,
        destination,
        activity,
        gazeTargetId,
        eyeHeight,
      }) => ({
        id,
        ownerId,
        name,
        position: { ...position },
        facing,
        path: copy(path),
        destination: destination ? { ...destination } : undefined,
        activity,
        gazeTargetId,
        eyeHeight,
      }),
    ),
    events: world.events.map(
      ({ id, at, type, message, characterId, objectId, entityId, placeId }) => ({
        id,
        at,
        type,
        message,
        characterId,
        objectId,
        entityId,
        placeId,
      }),
    ),
    visitors: world.visitors?.map(
      ({ id, name, position, facing, path, destination, expiresAt }) => ({
        id,
        name,
        position: { ...position },
        facing,
        path: copy(path),
        destination: destination ? { ...destination } : undefined,
        expiresAt,
      }),
    ),
    entities: world.entities?.map(publicEntity),
  };
}
