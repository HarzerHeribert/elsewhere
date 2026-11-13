export * from './mail';
export * from './studio';
import type { PublicCharacterMail, AccountCharacterMail } from './mail';
import { z } from 'zod';
export {
  BODY_RADIUS,
  NAVIGATION_GRID,
  canonicalWallApertures,
  findWalkPath,
  hasLineOfSight,
  isWalkable,
  segmentIsWalkable,
  worldObjectObservationHeight,
} from './spatial.js';

/** The wire contract is independent of Hubert's personality and hosting provider. */
export const PROTOCOL_VERSION = '0.1.0';
import { PositionSchema, type Position, type CharacterCommand, type CommandType } from './commands';
export {
  PositionSchema,
  CharacterCommandSchema,
  CharacterDecisionSchema,
  MODEL_ACTION_FORMAT,
  MODEL_ACTION_INSTRUCTIONS,
  ActionChoiceSchema,
  ActionChoicesSchema,
  narrowActionFormat,
} from './commands';
export type {
  Position,
  CharacterCommand,
  CharacterDecision,
  CommandType,
  ActionChoice,
} from './commands';

export interface Place {
  id: string;
  name: string;
  description: string;
  bounds: Bounds;
  entryPoint?: Position;
}
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface Obstacle extends Bounds {
  id: string;
  height: number;
  color?: string;
  shape?: 'rectangle' | 'ellipse';
  sightApertures?: Array<Bounds & { minY: number; maxY: number }>;
}
/** One thing a resident can do to an object with `use`. It says what the act is, never what governs the result. */
export type WorldControl = {
  id: string;
  description: string;
  /** A number range, written text, or neither: one control takes one kind of input. */
  value?: { min: number; max: number; step?: number; meaning: string };
  text?: { max: number; meaning: string };
};
export interface WorldObject {
  id: string;
  name: string;
  kind: string;
  description: string;
  position: Position;
  radius: number;
  height: number;
  color: string;
  tags: string[];
  affordances: string[];
  detail?: string;
  elevation?: number;
  observationHeight?: number;
  footprint?: Bounds;
  controls?: WorldControl[];
}
/** A living world entity has identity and an observable state, independent of resident agents. */
export interface WorldEntity extends WorldObject {
  species?: string;
  behavior: 'perched' | 'foraging' | 'flying' | 'swimming';
  elevation: number;
  facing: number;
  observationVersion: number;
}
export interface WorldResident {
  id: string;
  ownerId: string;
  name: string;
  position: Position;
  facing: number;
  path: Position[];
  destination?: Position;
  activity: string;
  gazeTargetId?: string;
  eyeHeight?: number;
}
export interface WorldVisitor {
  id: string;
  name: string;
  position: Position;
  facing: number;
  path: Position[];
  destination?: Position;
  expiresAt: number;
}
export interface VisitorSessionView {
  visitorId: string;
  position: Position;
  facing: number;
  path: Position[];
  destination?: Position;
  expiresAt: number;
  observedAt: number;
  placeId: string;
}
export interface VisitorRegistration extends VisitorSessionView {
  token: string;
}
export const VisitorActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), position: PositionSchema }).strict(),
  z.object({ type: z.literal('look'), facing: z.number().finite() }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
]);
export type VisitorAction = z.infer<typeof VisitorActionSchema>;
export interface WorldEvent {
  id: string;
  at: number;
  type: string;
  message: string;
  characterId?: string;
  objectId?: string;
  entityId?: string;
  placeId?: string;
}
export interface WorldState {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  layoutVersion?: number;
  spatialVersion?: number;
  bounds: Bounds;
  places: Place[];
  objects: WorldObject[];
  obstacles: Obstacle[];
  residents: WorldResident[];
  events: WorldEvent[];
  visitors?: WorldVisitor[];
  entities?: WorldEntity[];
  /** Hidden per-object mechanism state. Never projected publicly or to a model. */
  mechanisms?: Record<string, Record<string, number | number[]>>;
}
/** Public objects intentionally omit inspection-only/private detail. */
export type PublicWorldObject = Omit<WorldObject, 'detail'>;
export type PublicWorldEntity = Omit<WorldEntity, 'detail'>;
export type PublicWorldState = Omit<WorldState, 'objects' | 'entities' | 'mechanisms'> & {
  objects: PublicWorldObject[];
  entities?: PublicWorldEntity[];
};

export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  isWorldAdmin: boolean;
}
export interface AccountCapabilities {
  emailLinkAuthEnabled?: boolean;
  passkeyAuthEnabled?: boolean;
  socialProviders?: Array<'github' | 'google'>;
  linkedSocialProviders?: Array<'github' | 'google'>;
  ownerControlsRequirePasskey?: boolean;
  ownerControlsUnlocked?: boolean;
  passkeyVerifiedRecently?: boolean;
  enabled: boolean;
  passwordAuthEnabled: boolean;
  requiresEmailVerification: boolean;
}
/** Account endpoints are private session responses, never public world metadata. */
export interface ProviderIssue {
  id: string;
  characterId: string;
  kind: 'unconfigured' | 'unavailable' | 'failed' | 'allowance' | 'invalid';
  code?: string;
  fields?: string[];
  retrying?: boolean;
  workload?: 'decision' | 'reflection';
  since: number;
  lastAt: number;
  message: string;
  resolvedAt?: number;
}
export interface AccountResponse extends AccountCapabilities {
  characterMail?: AccountCharacterMail[];
  characterMailUnavailable?: boolean;
  characterIssues?: ProviderIssue[];
  user: AccountSummary | null;
  /** Private session capability, independent from world administration. */
  managedCharacterIds: string[];
}
export interface Observation {
  characterId: string;
  placeId: string;
  position: Position;
  facing: number;
  visibleObjects: WorldObject[];
  events: WorldEvent[];
  observedAt: number;
  knownPlaces?: Array<{ id: string; name: string; position: Position }>;
  visibleEntities?: WorldEntity[];
}
/** Evidence supplied by the authoritative world after a successful entity observation. */
export interface EntityEncounter {
  entityId: string;
  kind: string;
  species?: string;
  behavior: WorldEntity['behavior'];
  observationVersion: number;
  topics: string[];
}
export interface WorldOutcome {
  id: string;
  command: CharacterCommand;
  status: 'completed' | 'started' | 'rejected';
  summary: string;
  at: number;
  objectId?: string;
  placeId?: string;
  evidence?: string;
  energyCost?: number;
  moodDelta?: number;
  entityId?: string;
  encounter?: EntityEncounter;
}
export interface PublicMemory {
  id: string;
  at: number;
  summary: string;
  cues: string[];
  placeId?: string;
  objectId?: string;
  entityId?: string;
  moodAtEncoding?: number;
  salience?: number;
  sourceUrl?: string;
  sourceTitle?: string;
}
export interface PublicCharacterState {
  id: string;
  name: string;
  mood: number;
  energy: number;
  boredom: number;
  frustration: number;
  socialAppetite: number;
  activity: string;
  status: string;
  currentThought?: string;
  lastReflection?: string;
  /** What the character last wrote about itself after resting, in its own words. */
  portrait?: PublicPortrait;
  /** The portraits before the current one, oldest first. */
  portraits?: PublicPortrait[];
}
export interface PublicPortrait {
  text: string;
  /** World time. */
  at: number;
}
export interface PublicRuntimeState {
  mode: 'local' | 'compatible' | 'ollama';
  paused: boolean;
  tick: number;
  startedAt: number;
  /** The world's own clock. It stands still while the world is paused or restarting. */
  simulatedAt: number;
  /**
   * How the world clock maps to real time, oldest first. From each entry on, the real time of
   * world time `t` is `wall + (t - at) / simulationRate`; earlier times use the first entry.
   * Absent when the world does not follow real time.
   */
  clock?: ReadonlyArray<{ at: number; wall: number }>;
  costUsd: number;
  modelCalls?: number;
  modelStatus?: string;
  costKnown?: boolean;
  simulationRate?: number;
}
/** One step on the character's public trail. Text is what the character itself wrote or read. */
export interface PublicTrailEntry {
  id: string;
  at: number;
  /** The command type of the step, or 'portrait' when the character wrote about itself. */
  kind: CommandType | 'portrait';
  why?: string;
  pursuitId?: string;
  /** The query, note text, question, reason or page title for the step. */
  text?: string;
  url?: string;
  placeId?: string;
  /** How often the same step was repeated in a row; absent for a single step. */
  times?: number;
}
export type PublicPursuitEntry = { id: string; at: number } & (
  | { kind: 'search'; query: string; sourceCount: number }
  | { kind: 'read'; sourceId: string; url: string; title: string }
  | { kind: 'note'; text: string; surprised: boolean; sourceIds: string[] }
  | {
      kind: 'made';
      creationId: string;
      path: string;
      title: string;
      url: string;
      commitSha: string;
    }
  | { kind: 'tried'; text: string; objectId: string }
);
/** A question the character chose to follow, with what it searched, read and noted. */
export interface PublicPursuit {
  id: string;
  question: string;
  why: string;
  status: 'active' | 'open' | 'set-aside';
  openedAt: number;
  lastAt: number;
  questions: string[];
  setAsideReason?: string;
  entries: PublicPursuitEntry[];
}
export interface PublicCreation {
  id: string;
  characterId: string;
  title: string;
  description: string;
  url: string;
  kind: 'repository' | 'website' | 'document' | 'image' | 'other';
  createdAt: number;
  pinnedAt?: number;
  provenance: 'character' | 'owner';
  /** Where a made creation came from, when the character made it itself. */
  origin?: { pursuitId?: string; path: string; commitSha: string };
}
export interface PublicSnapshot {
  mail?: PublicCharacterMail;
  creations?: PublicCreation[];
  world: PublicWorldState;
  character: PublicCharacterState;
  events: WorldEvent[];
  memories: PublicMemory[];
  recalledMemory?: PublicMemory | null;
  runtime: PublicRuntimeState;
  artifacts?: PublicArtifact[];
  wishes?: PublicWish[];
  /** Newest 120 steps, oldest first. */
  trail: PublicTrailEntry[];
  pursuits: PublicPursuit[];
}

export interface PublicArtifact {
  id: string;
  name: string;
  description: string;
  url: string;
  createdAt: number;
}

/** Something a resident said they would like, in their own words. It installs nothing. */
export interface PublicWish {
  id: string;
  text: string;
  /** Real wall-clock time. */
  createdAt: number;
  /** 'fulfilled' is the owner's word that the wish was built. */
  status: 'pending' | 'fulfilled' | 'declined';
  fulfilledAt?: number;
  declinedAt?: number;
}

export const VisitorMessageSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();
