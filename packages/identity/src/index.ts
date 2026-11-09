import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const revision = z.number().int().positive().safe();
const expiresAt = z.number().int().nonnegative().safe().optional();

/** Human ownership is independent of an account's platform administration role. */
export const CharacterRegistrationSchema = z
  .object({ id: identifier, ownerUserId: identifier })
  .strict();
export type CharacterRegistration = z.infer<typeof CharacterRegistrationSchema>;

export const CharacterResidencySchema = z
  .object({ worldId: identifier, characterId: identifier, enabled: z.boolean() })
  .strict();
export type CharacterResidency = z.infer<typeof CharacterResidencySchema>;

/** Metadata only. A private adapter maps this ID to its protected credential storage. */
export const ProviderConnectionSchema = z
  .object({
    id: identifier,
    ownerUserId: identifier,
    provider: identifier,
    enabled: z.boolean(),
    revision,
    expiresAt,
  })
  .strict();
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const CharacterResourceGrantSchema = z
  .object({
    id: identifier,
    worldId: identifier,
    characterId: identifier,
    ownerUserId: identifier,
    connectionId: identifier,
    capabilities: z.array(identifier).min(1).max(64),
    enabled: z.boolean(),
    revision,
    expiresAt,
  })
  .strict();
export type CharacterResourceGrant = z.infer<typeof CharacterResourceGrantSchema>;

export const HostResourceConfigurationSchema = z
  .object({
    characters: z.array(CharacterRegistrationSchema).max(1024),
    residencies: z.array(CharacterResidencySchema).max(1024),
    connections: z.array(ProviderConnectionSchema).max(1024),
    grants: z.array(CharacterResourceGrantSchema).max(4096),
  })
  .strict();
export type HostResourceConfiguration = z.infer<typeof HostResourceConfigurationSchema>;

/** Constructed by authenticated host code, never accepted as an HTTP/model actor override. */
export const CharacterResourceScopeSchema = z
  .object({
    worldId: identifier,
    characterId: identifier,
    ownerUserId: identifier,
    connectionId: identifier,
    capabilityId: identifier,
  })
  .strict();
export type CharacterResourceScope = z.infer<typeof CharacterResourceScopeSchema>;

export type CharacterResourceResolution =
  | {
      decision: 'denied';
      reason:
        | 'invalid_scope'
        | 'unknown_character'
        | 'resident_not_admitted'
        | 'wrong_owner'
        | 'connection_unavailable'
        | 'not_granted';
    }
  | ({
      decision: 'eligible';
      grantId: string;
      grantRevision: number;
      connectionRevision: number;
    } & CharacterResourceScope);

export class OwnershipConfigurationError extends Error {
  constructor() {
    // Zod diagnostics can contain credential-like rejected values. Keep the error fixed.
    super('Character ownership/resource configuration is invalid or ambiguous.');
  }
}

const key = (...parts: string[]) => JSON.stringify(parts);

/**
 * Pure authorization policy, not a credential vault, quota ledger or execution broker.
 * The current admission policy enables only Hubert. Additional definitions may be staged
 * inactive; expanding residency requires an explicit trusted-host policy change.
 */
export class HostResourceRegistry {
  private configuration!: HostResourceConfiguration;
  private readonly admittedCharacters: ReadonlySet<string>;

  constructor(configuration: unknown, admittedCharacterIds: readonly string[] = ['hubert']) {
    if (
      !admittedCharacterIds.length ||
      admittedCharacterIds.some((id) => !identifier.safeParse(id).success) ||
      new Set(admittedCharacterIds).size !== admittedCharacterIds.length
    )
      throw new OwnershipConfigurationError();
    this.admittedCharacters = new Set(admittedCharacterIds);
    this.replace(configuration);
  }

  /** Host-only atomic replacement. A failed update preserves the previously validated policy. */
  replace(configuration: unknown): void {
    const parsed = HostResourceConfigurationSchema.safeParse(configuration);
    if (!parsed.success) throw new OwnershipConfigurationError();
    const value = parsed.data;
    const unique = (values: readonly string[]) => new Set(values).size === values.length;
    if (
      !unique(value.characters.map((entry) => entry.id)) ||
      !unique(value.connections.map((entry) => entry.id)) ||
      !unique(value.grants.map((entry) => entry.id)) ||
      !unique(value.residencies.map((entry) => key(entry.worldId, entry.characterId))) ||
      !unique(
        value.residencies.filter((entry) => entry.enabled).map((entry) => entry.characterId),
      ) ||
      !unique(
        value.grants.map((entry) => key(entry.worldId, entry.characterId, entry.connectionId)),
      ) ||
      value.grants.some((entry) => !unique(entry.capabilities))
    )
      throw new OwnershipConfigurationError();
    const characters = new Map(value.characters.map((entry) => [entry.id, entry]));
    const connections = new Map(value.connections.map((entry) => [entry.id, entry]));
    const residencyKeys = new Set(
      value.residencies.map((entry) => key(entry.worldId, entry.characterId)),
    );
    if (
      value.residencies.some(
        (entry) =>
          !characters.has(entry.characterId) ||
          (entry.enabled && !this.admittedCharacters.has(entry.characterId)),
      ) ||
      value.grants.some((entry) => {
        const character = characters.get(entry.characterId);
        const connection = connections.get(entry.connectionId);
        return (
          !character ||
          !connection ||
          !residencyKeys.has(key(entry.worldId, entry.characterId)) ||
          character.ownerUserId !== entry.ownerUserId ||
          connection.ownerUserId !== entry.ownerUserId
        );
      })
    )
      throw new OwnershipConfigurationError();
    this.configuration = value;
  }

  resolve(scope: unknown, now = Date.now()): CharacterResourceResolution {
    const parsed = CharacterResourceScopeSchema.safeParse(scope);
    if (!parsed.success || !Number.isSafeInteger(now) || now < 0)
      return { decision: 'denied', reason: 'invalid_scope' };
    const request = parsed.data;
    const character = this.configuration.characters.find(
      (entry) => entry.id === request.characterId,
    );
    if (!character) return { decision: 'denied', reason: 'unknown_character' };
    if (
      !this.admittedCharacters.has(request.characterId) ||
      !this.configuration.residencies.some(
        (entry) =>
          entry.worldId === request.worldId &&
          entry.characterId === request.characterId &&
          entry.enabled,
      )
    )
      return { decision: 'denied', reason: 'resident_not_admitted' };
    if (character.ownerUserId !== request.ownerUserId)
      return { decision: 'denied', reason: 'wrong_owner' };
    const connection = this.configuration.connections.find(
      (entry) => entry.id === request.connectionId,
    );
    if (!connection?.enabled || (connection.expiresAt !== undefined && connection.expiresAt <= now))
      return { decision: 'denied', reason: 'connection_unavailable' };
    if (connection.ownerUserId !== request.ownerUserId)
      return { decision: 'denied', reason: 'wrong_owner' };
    const grant = this.configuration.grants.find(
      (entry) =>
        entry.worldId === request.worldId &&
        entry.characterId === request.characterId &&
        entry.connectionId === request.connectionId,
    );
    if (
      !grant?.enabled ||
      grant.ownerUserId !== request.ownerUserId ||
      !grant.capabilities.includes(request.capabilityId) ||
      (grant.expiresAt !== undefined && grant.expiresAt <= now)
    )
      return { decision: 'denied', reason: 'not_granted' };
    return {
      decision: 'eligible',
      ...request,
      grantId: grant.id,
      grantRevision: grant.revision,
      connectionRevision: connection.revision,
    };
  }

  canManage(userId: string, characterId: string): boolean {
    const character = this.configuration.characters.find((entry) => entry.id === characterId);
    return !!character && canManageCharacter({ userId, platformRole: 'user' }, character);
  }
}

export interface UserPrincipal {
  userId: string;
  platformRole: 'user' | 'admin';
}

/** Moderation rights do not create character ownership or resource spending permission. */
export function canManageCharacter(
  principal: UserPrincipal,
  character: CharacterRegistration,
): boolean {
  return (
    identifier.safeParse(principal.userId).success &&
    CharacterRegistrationSchema.safeParse(character).success &&
    principal.userId === character.ownerUserId
  );
}

export function canGrantCharacterConnection(
  principal: UserPrincipal,
  character: CharacterRegistration,
  connection: ProviderConnection,
): boolean {
  return (
    canManageCharacter(principal, character) &&
    ProviderConnectionSchema.safeParse(connection).success &&
    principal.userId === connection.ownerUserId
  );
}

export function createSoleHubertRegistry(options: {
  ownerUserId: string;
  connectionId: string;
  provider: string;
  worldId?: string;
}): HostResourceRegistry {
  const worldId = options.worldId ?? 'elsewhere';
  return new HostResourceRegistry({
    characters: [{ id: 'hubert', ownerUserId: options.ownerUserId }],
    residencies: [{ worldId, characterId: 'hubert', enabled: true }],
    connections: [
      {
        id: options.connectionId,
        ownerUserId: options.ownerUserId,
        provider: options.provider,
        enabled: true,
        revision: 1,
      },
    ],
    grants: [
      {
        id: 'hubert-default-model',
        worldId,
        characterId: 'hubert',
        ownerUserId: options.ownerUserId,
        connectionId: options.connectionId,
        capabilities: ['model.decision', 'model.reflection', 'model.expression'],
        enabled: true,
        revision: 1,
      },
    ],
  });
}
