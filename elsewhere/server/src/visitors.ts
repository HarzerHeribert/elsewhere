import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  VisitorActionSchema,
  type Position,
  type VisitorRegistration,
  type VisitorSessionView,
  type WorldState,
  type WorldVisitor,
  segmentIsWalkable,
} from '@elsewhere/character-interfaces';
import { findPath, isWalkable, placeAt } from './world.js';

const TTL = 30 * 60_000;
const IDLE_TTL = 5 * 60_000;
const ACTIVATION_TTL = 30_000;
const MAX_SESSIONS = 64;
const MAX_SESSIONS_PER_SOURCE = 2;
const VISITOR_SPEED = 0.0032;
interface Session {
  visitor: WorldVisitor;
  token: string;
  updatedAt: number;
  lastActiveAt: number;
  /** Trusted host source only; never included in a public visitor or registration. */
  admissionKey: string;
  activated: boolean;
  activationDeadline: number;
}
export class VisitorError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Visitors are ephemeral exploration sessions, never characters or owner credentials. */
export class VisitorRegistry {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly now: () => number = Date.now) {}

  private purge() {
    const now = this.now();
    for (const [id, session] of this.sessions)
      if (
        session.visitor.expiresAt <= now ||
        session.lastActiveAt + IDLE_TTL <= now ||
        (!session.activated && session.activationDeadline <= now)
      )
        this.sessions.delete(id);
  }
  private advance(session: Session, world: WorldState) {
    const now = this.now();
    let remaining = Math.max(0, Math.min(now - session.updatedAt, TTL)) * VISITOR_SPEED;
    session.updatedAt = now;
    const visitor = session.visitor;
    if (!isWalkable(world, visitor.position)) {
      visitor.position = { x: 7, z: 7 };
      visitor.path = [];
      visitor.destination = undefined;
    }
    while (visitor.path.length && remaining > 0) {
      const next = visitor.path[0];
      if (!segmentIsWalkable(world, visitor.position, next)) {
        visitor.path = [];
        visitor.destination = undefined;
        break;
      }
      const distance = Math.hypot(next.x - visitor.position.x, next.z - visitor.position.z);
      if (distance <= remaining) {
        visitor.position = { ...next };
        visitor.path.shift();
        remaining -= distance;
      } else {
        visitor.position = {
          x: visitor.position.x + ((next.x - visitor.position.x) / distance) * remaining,
          z: visitor.position.z + ((next.z - visitor.position.z) / distance) * remaining,
        };
        remaining = 0;
      }
    }
    if (!visitor.path.length) visitor.destination = undefined;
  }
  private view(session: Session, world: WorldState): VisitorSessionView {
    const visitor = session.visitor;
    return {
      visitorId: visitor.id,
      position: { ...visitor.position },
      facing: visitor.facing,
      path: structuredClone(visitor.path),
      destination: visitor.destination ? { ...visitor.destination } : undefined,
      expiresAt: visitor.expiresAt,
      observedAt: session.updatedAt,
      placeId: placeAt(world, visitor.position),
    };
  }
  private authorize(id: string, token: string): Session {
    this.purge();
    const session = this.sessions.get(id);
    const expected = Buffer.from(session?.token ?? '');
    const supplied = Buffer.from(token);
    if (
      !session ||
      !token ||
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new VisitorError(401, 'This visitor session is unavailable or unauthorized.');
    return session;
  }
  authenticate(id: string, token: string): void {
    this.authorize(id, token);
  }
  /** At most two concurrent visits per trusted source, including unused registrations.
   * The caller supplies the canonical transport source, never a value from request JSON.
   * This intentionally trades large shared-NAT groups for bounded anonymous admission.
   */
  create(world: WorldState, admissionKey = 'local'): VisitorRegistration {
    if (!admissionKey || admissionKey.length > 128 || /[\x00-\x20\x7f]/.test(admissionKey))
      throw new VisitorError(400, 'The visitor source is invalid.');
    this.purge();
    const fromSource = [...this.sessions.values()].filter(
      (session) => session.admissionKey === admissionKey,
    ).length;
    if (fromSource >= MAX_SESSIONS_PER_SOURCE)
      throw new VisitorError(429, 'This connection already has two active visits.');
    if (this.sessions.size >= MAX_SESSIONS)
      throw new VisitorError(503, 'The local world has reached its visitor limit.');
    const now = this.now();
    const spawn: Position = { x: 7, z: 7 };
    if (!isWalkable(world, spawn))
      throw new VisitorError(503, 'The visitor entrance is temporarily unavailable.');
    const session: Session = {
      token: randomBytes(32).toString('hex'),
      updatedAt: now,
      lastActiveAt: now,
      admissionKey,
      activated: false,
      activationDeadline: now + ACTIVATION_TTL,
      visitor: {
        id: `visitor-${randomUUID()}`,
        name: 'Visitor',
        position: spawn,
        facing: Math.PI,
        path: [],
        expiresAt: now + TTL,
      },
    };
    this.sessions.set(session.visitor.id, session);
    return { ...this.view(session, world), token: session.token };
  }
  get(id: string, token: string, world: WorldState): VisitorSessionView {
    const session = this.authorize(id, token);
    session.activated = true;
    session.lastActiveAt = this.now();
    this.advance(session, world);
    return this.view(session, world);
  }
  act(id: string, token: string, input: unknown, world: WorldState): VisitorSessionView {
    const session = this.authorize(id, token);
    const parsed = VisitorActionSchema.safeParse(input);
    if (!parsed.success)
      throw new VisitorError(400, 'Visitor sessions support only moving, looking and stopping.');
    this.advance(session, world);
    const visitor = session.visitor;
    const action = parsed.data;
    if (action.type === 'move') {
      const distance = Math.hypot(
        action.position.x - visitor.position.x,
        action.position.z - visitor.position.z,
      );
      let path: Position[] | null;
      if (distance <= 2) {
        // Keyboard movement follows the intended vector, not staircase-shaped grid nodes.
        // Never route a short step around a wall the player is trying to walk into.
        const clear = segmentIsWalkable(world, visitor.position, action.position);
        path = clear ? (distance > 0.001 ? [{ ...action.position }] : []) : null;
      } else path = findPath(world, visitor.position, action.position);
      if (!path) throw new VisitorError(409, 'That position cannot be reached safely.');
      visitor.path = path;
      visitor.destination = path.length ? { ...action.position } : undefined;
    } else if (action.type === 'look')
      visitor.facing = Math.atan2(Math.sin(action.facing), Math.cos(action.facing));
    else {
      visitor.path = [];
      visitor.destination = undefined;
    }
    // Rejected commands cannot claim an unused allocation or keep an abandoned one alive.
    session.activated = true;
    session.lastActiveAt = this.now();
    return this.view(session, world);
  }
  /** Only an explicit successful host world reset should discard all visitor credentials. */
  clear(): void {
    this.sessions.clear();
  }
  publicVisitors(world: WorldState): WorldVisitor[] {
    this.purge();
    return [...this.sessions.values()]
      .filter((session) => session.activated)
      .map((session) => {
        this.advance(session, world);
        return structuredClone(session.visitor);
      });
  }
}
