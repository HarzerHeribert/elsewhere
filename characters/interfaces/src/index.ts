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
import { PositionSchema, type Position, type CharacterCommand } from './commands';
export {
  PositionSchema,
  CharacterCommandSchema,
  MODEL_ACTION_FORMAT,
  MODEL_ACTION_INSTRUCTIONS,
} from './commands';
export type { Position, CharacterCommand } from './commands';

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
}
/** Public objects intentionally omit inspection-only/private detail. */
export type PublicWorldObject = Omit<WorldObject, 'detail'>;
export type PublicWorldEntity = Omit<WorldEntity, 'detail'>;
export type PublicWorldState = Omit<WorldState, 'objects' | 'entities'> & {
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
  workload?: 'decision' | 'notebook' | 'reflection';
  since: number;
  lastAt: number;
  message: string;
  resolvedAt?: number;
}
export interface AccountResponse extends AccountCapabilities {
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
  interests: Array<{ id: string; name: string; strength: number; encounters?: number }>;
  currentThought?: string;
  lastReflection?: string;
}
export interface PublicRuntimeState {
  mode: 'local' | 'compatible' | 'ollama';
  paused: boolean;
  tick: number;
  startedAt: number;
  simulatedAt: number;
  costUsd: number;
  modelCalls?: number;
  modelStatus?: string;
  costKnown?: boolean;
  simulationRate?: number;
}
export interface PublicNotebookEntry {
  id: string;
  at: number;
  text: string;
  sourceIds: string[];
}
export interface PublicNotebook {
  enabled: boolean;
  entries: PublicNotebookEntry[];
  draft?: { id: string; at: number; text: string };
}
export interface PublicResearchEpisode {
  id: string;
  at: number;
  topic: string;
  query: string;
  context: string;
  status: 'searching' | 'sources-found' | 'reading' | 'read' | 'deferred';
  sources: Array<{
    id: string;
    url: string;
    title: string;
    snippet: string;
    status: 'returned' | 'read' | 'deferred';
    excerpt?: string;
    retrievedAt?: number;
  }>;
  outcome?: string;
  nextStep?: string;
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
}
export interface PublicSnapshot {
  creations?: PublicCreation[];
  research?: PublicResearchEpisode[];
  world: PublicWorldState;
  character: PublicCharacterState;
  events: WorldEvent[];
  memories: PublicMemory[];
  recalledMemory?: PublicMemory | null;
  runtime: PublicRuntimeState;
  artifacts?: PublicArtifact[];
  wishes?: PublicWish[];
  notebook?: PublicNotebook;
}

export interface PublicArtifact {
  id: string;
  name: string;
  description: string;
  url: string;
  createdAt: number;
}

export interface PublicWish {
  id: string;
  title: string;
  description: string;
  reason: string;
  createdAt: number;
  status: 'pending' | 'fulfilled' | 'declined';
  requestedObjectId: string;
  fulfilledAt?: number;
  declinedAt?: number;
  receiptId?: string;
}

export const VisitorMessageSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();
