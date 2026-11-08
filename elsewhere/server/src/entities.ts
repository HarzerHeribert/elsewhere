import type { Position, WorldEntity } from '@elsewhere/character-interfaces';

type EntityBody = Omit<
  WorldEntity,
  'position' | 'elevation' | 'facing' | 'behavior' | 'observationVersion'
>;
type MotionProfile =
  | {
      type: 'perch-cycle';
      home: Position;
      perch: Position;
      perchElevation: number;
      radius: number;
      offsetMs: number;
    }
  | {
      type: 'orbit';
      home: Position;
      radiusX: number;
      radiusZ: number;
      elevation: number;
      periodMs: number;
      behavior: 'swimming' | 'flying';
    };
interface EntityDefinition {
  body: EntityBody;
  motion: MotionProfile;
}
interface Pose {
  position: Position;
  elevation: number;
  behavior: WorldEntity['behavior'];
}

/** Ecology is owned by the world. A resident or viewer cannot drive these clocks or poses. */
const definitions: EntityDefinition[] = [
  {
    body: {
      id: 'courtyard-sparrow',
      name: 'A courtyard sparrow',
      kind: 'bird',
      species: 'House sparrow',
      description: 'A small brown sparrow lives between the courtyard and its bench.',
      radius: 0.18,
      height: 0.22,
      color: '#a78661',
      tags: ['birds', 'nature', 'patterns'],
      affordances: ['inspect'],
    },
    motion: {
      type: 'perch-cycle',
      home: { x: 7, z: 6 },
      perch: { x: 5.8, z: 4.1 },
      perchElevation: 0.78,
      radius: 0.65,
      offsetMs: 0,
    },
  },
  {
    body: {
      id: 'orchard-robin',
      name: 'An orchard robin',
      kind: 'bird',
      species: 'European robin',
      description: 'A red-breasted robin moves between the orchard floor and a low branch.',
      radius: 0.18,
      height: 0.25,
      color: '#bd744e',
      tags: ['birds', 'nature', 'sound', 'patterns'],
      affordances: ['inspect'],
    },
    motion: {
      type: 'perch-cycle',
      home: { x: -18.5, z: 13 },
      perch: { x: -19, z: 15 },
      perchElevation: 1.8,
      radius: 0.55,
      offsetMs: 40_000,
    },
  },
  {
    body: {
      id: 'pond-duck',
      name: 'A pond duck',
      kind: 'bird',
      species: 'Mallard',
      description: 'A green-headed duck follows a slow course across the pond.',
      radius: 0.32,
      height: 0.4,
      color: '#6f8974',
      tags: ['birds', 'nature', 'water', 'patterns'],
      affordances: ['inspect'],
    },
    motion: {
      type: 'orbit',
      home: { x: 20, z: 14 },
      radiusX: 2.4,
      radiusZ: 1.6,
      elevation: 0.08,
      periodMs: 84_000,
      behavior: 'swimming',
    },
  },
  {
    body: {
      id: 'garden-butterfly',
      name: 'A garden butterfly',
      kind: 'butterfly',
      description: 'A small orange butterfly flutters above the raised garden.',
      radius: 0.12,
      height: 0.16,
      color: '#dfad66',
      tags: ['insects', 'color', 'patterns'],
      affordances: ['inspect'],
    },
    motion: {
      type: 'orbit',
      home: { x: 6, z: -3 },
      radiusX: 1.15,
      radiusZ: 0.8,
      elevation: 1.15,
      periodMs: 19_000,
      behavior: 'flying',
    },
  },
];
const definitionById = new Map(definitions.map((definition) => [definition.body.id, definition]));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function sampleMotion(profile: MotionProfile, elapsed: number): Pose {
  if (profile.type === 'orbit') {
    const angle = (elapsed / profile.periodMs) * Math.PI * 2;
    return {
      position: {
        x: profile.home.x + Math.cos(angle) * profile.radiusX,
        z: profile.home.z + Math.sin(angle) * profile.radiusZ,
      },
      elevation:
        profile.elevation +
        Math.sin(angle * (profile.behavior === 'flying' ? 3 : 2)) *
          (profile.behavior === 'flying' ? 0.4 : 0.015),
      behavior: profile.behavior,
    };
  }
  const t = (((elapsed + profile.offsetMs) % 90_000) + 90_000) % 90_000;
  if (t < 25_000 || t >= 72_000) {
    const portion = t < 25_000 ? t / 25_000 : (t - 72_000) / 18_000;
    return {
      position: {
        x: profile.home.x + Math.sin(portion * Math.PI * 2) * profile.radius,
        z: profile.home.z + Math.sin(portion * Math.PI * 4) * profile.radius * 0.7,
      },
      elevation: 0.08,
      behavior: 'foraging',
    };
  }
  if (t < 35_000) {
    const portion = (t - 25_000) / 10_000;
    return {
      position: {
        x: lerp(profile.home.x, profile.perch.x, portion),
        z: lerp(profile.home.z, profile.perch.z, portion),
      },
      elevation: lerp(0.08, profile.perchElevation, portion) + Math.sin(portion * Math.PI) * 1.6,
      behavior: 'flying',
    };
  }
  if (t < 60_000)
    return {
      position: { ...profile.perch },
      elevation: profile.perchElevation,
      behavior: 'perched',
    };
  const portion = (t - 60_000) / 12_000;
  return {
    position: {
      x: lerp(profile.perch.x, profile.home.x, portion),
      z: lerp(profile.perch.z, profile.home.z, portion),
    },
    elevation: lerp(profile.perchElevation, 0.08, portion) + Math.sin(portion * Math.PI) * 1.9,
    behavior: 'flying',
  };
}

function poseEntity(entity: WorldEntity, profile: MotionProfile, elapsed: number): WorldEntity {
  const pose = sampleMotion(profile, elapsed);
  const next = sampleMotion(profile, elapsed + 50);
  const moving =
    Math.hypot(next.position.x - pose.position.x, next.position.z - pose.position.z) > 0.00001;
  return {
    ...structuredClone(entity),
    ...pose,
    facing: moving
      ? Math.atan2(next.position.x - pose.position.x, next.position.z - pose.position.z)
      : 0.6 + Math.sin(elapsed / 7000) * 0.35,
    // A version identifies the authoritative simulation instant, not a render frame or model claim.
    observationVersion: Math.floor(elapsed) + 1,
  };
}

export function createInitialEntities(createdAt: number, now = createdAt): WorldEntity[] {
  const elapsed = Math.max(0, now - createdAt);
  return definitions.map(({ body, motion }) =>
    poseEntity(
      {
        ...structuredClone(body),
        position: { x: 0, z: 0 },
        elevation: 0,
        facing: 0,
        behavior: 'perched',
        observationVersion: 1,
      },
      motion,
      elapsed,
    ),
  );
}

/** Absolute-clock motion gives the same result across restarts and different tick sizes. */
export function advanceEntities(
  entities: readonly WorldEntity[],
  createdAt: number,
  now: number,
): WorldEntity[] {
  const elapsed = Math.max(0, now - createdAt);
  return entities.map((entity) => {
    const definition = definitionById.get(entity.id);
    return definition ? poseEntity(entity, definition.motion, elapsed) : structuredClone(entity);
  });
}

export function publicEntity(entity: WorldEntity): WorldEntity {
  const {
    id,
    name,
    kind,
    species,
    description,
    position,
    radius,
    height,
    color,
    tags,
    affordances,
    behavior,
    elevation,
    facing,
    observationVersion,
  } = entity;
  return {
    id,
    name,
    kind,
    species,
    description,
    position: { ...position },
    radius,
    height,
    color,
    tags: [...tags],
    affordances: [...affordances],
    behavior,
    elevation,
    facing,
    observationVersion,
  };
}
