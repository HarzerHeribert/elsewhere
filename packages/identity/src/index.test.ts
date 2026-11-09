import { describe, expect, it } from 'vitest';
import {
  canGrantCharacterConnection,
  canManageCharacter,
  createSoleHubertRegistry,
  HostResourceRegistry,
  type HostResourceConfiguration,
} from './index';

const now = Date.parse('2026-11-09T12:00:00Z');
function configuration(): HostResourceConfiguration {
  return {
    characters: [
      { id: 'hubert', ownerUserId: 'owner-a' },
      { id: 'future', ownerUserId: 'owner-b' },
    ],
    residencies: [
      { worldId: 'elsewhere', characterId: 'hubert', enabled: true },
      { worldId: 'elsewhere', characterId: 'future', enabled: false },
    ],
    connections: [
      {
        id: 'owner-a-model',
        ownerUserId: 'owner-a',
        provider: 'openai.chatgpt',
        enabled: true,
        revision: 1,
      },
      {
        id: 'owner-b-model',
        ownerUserId: 'owner-b',
        provider: 'other.model',
        enabled: true,
        revision: 1,
      },
    ],
    grants: [
      {
        id: 'hubert-model',
        worldId: 'elsewhere',
        characterId: 'hubert',
        ownerUserId: 'owner-a',
        connectionId: 'owner-a-model',
        capabilities: ['model.decision', 'model.reflection'],
        enabled: true,
        revision: 2,
      },
    ],
  };
}
const scope = {
  worldId: 'elsewhere',
  characterId: 'hubert',
  ownerUserId: 'owner-a',
  connectionId: 'owner-a-model',
  capabilityId: 'model.decision',
};

describe('character ownership and provider delegation', () => {
  it('resolves only the explicit character/owner/world/connection/capability grant', () => {
    const registry = new HostResourceRegistry(configuration());
    expect(registry.resolve(scope, now)).toEqual({
      decision: 'eligible',
      ...scope,
      grantId: 'hubert-model',
      grantRevision: 2,
      connectionRevision: 1,
    });
    expect(registry.resolve({ ...scope, capabilityId: 'model.reflection' }, now).decision).toBe(
      'eligible',
    );
    expect(registry.resolve({ ...scope, capabilityId: 'email.send' }, now)).toEqual({
      decision: 'denied',
      reason: 'not_granted',
    });
    expect(registry.resolve({ ...scope, connectionId: 'owner-b-model' }, now)).toEqual({
      decision: 'denied',
      reason: 'wrong_owner',
    });
  });
  it.each(['worldId', 'characterId', 'ownerUserId', 'connectionId'] as const)(
    'denies the wrong %s',
    (field) => {
      expect(
        new HostResourceRegistry(configuration()).resolve({ ...scope, [field]: 'another' }, now)
          .decision,
      ).toBe('denied');
    },
  );
  it('keeps platform administration independent from character/resource management', () => {
    const config = configuration();
    const administrator = { userId: 'platform-admin', platformRole: 'admin' as const };
    const owner = { userId: 'owner-a', platformRole: 'user' as const };
    expect(canManageCharacter(administrator, config.characters[0])).toBe(false);
    expect(canManageCharacter(owner, config.characters[0])).toBe(true);
    expect(canGrantCharacterConnection(owner, config.characters[0], config.connections[0])).toBe(
      true,
    );
    expect(canGrantCharacterConnection(owner, config.characters[0], config.connections[1])).toBe(
      false,
    );
    expect(new HostResourceRegistry(config).canManage(owner.userId, 'hubert')).toBe(true);
    expect(new HostResourceRegistry(config).canManage(administrator.userId, 'hubert')).toBe(false);
  });
  it.each([
    { ...scope, platformRole: 'admin' },
    { ...scope, actor: 'owner-a' },
    { ...scope, accessToken: 'fixture-secret' },
  ])('refuses authority and credentials mixed into the strict service scope', (request) => {
    expect(new HostResourceRegistry(configuration()).resolve(request, now)).toEqual({
      decision: 'denied',
      reason: 'invalid_scope',
    });
  });
  it('permits inactive future definitions while admitting only Hubert', () => {
    const config = configuration();
    const registry = new HostResourceRegistry(config);
    expect(
      registry.resolve(
        { ...scope, characterId: 'future', ownerUserId: 'owner-b', connectionId: 'owner-b-model' },
        now,
      ),
    ).toEqual({ decision: 'denied', reason: 'resident_not_admitted' });
    config.residencies[1].enabled = true;
    expect(() => new HostResourceRegistry(config)).toThrow('invalid or ambiguous');
  });
  it('revokes grant/residency/connection access immediately on a validated host update', () => {
    const config = configuration();
    const registry = new HostResourceRegistry(config);
    config.grants[0].enabled = false;
    registry.replace(config);
    expect(registry.resolve(scope, now)).toEqual({ decision: 'denied', reason: 'not_granted' });
    config.grants[0].enabled = true;
    config.connections[0].enabled = false;
    registry.replace(config);
    expect(registry.resolve(scope, now)).toEqual({
      decision: 'denied',
      reason: 'connection_unavailable',
    });
    config.connections[0].enabled = true;
    config.residencies[0].enabled = false;
    registry.replace(config);
    expect(registry.resolve(scope, now)).toEqual({
      decision: 'denied',
      reason: 'resident_not_admitted',
    });
  });
  it('expires connections and grants and does not permit credentials in policy records', () => {
    const config = configuration();
    config.connections[0].expiresAt = now;
    expect(new HostResourceRegistry(config).resolve(scope, now)).toEqual({
      decision: 'denied',
      reason: 'connection_unavailable',
    });
    config.connections[0].expiresAt = now + 1;
    config.grants[0].expiresAt = now;
    expect(new HostResourceRegistry(config).resolve(scope, now)).toEqual({
      decision: 'denied',
      reason: 'not_granted',
    });
    expect(() => new HostResourceRegistry({ ...config, credentials: 'fixture-secret' })).toThrow(
      'invalid or ambiguous',
    );
  });
  it('rejects cross-owner grants, duplicate identities, ambiguous bindings and staged admissions', () => {
    const wrongOwner = configuration();
    wrongOwner.grants[0].connectionId = 'owner-b-model';
    const duplicate = configuration();
    duplicate.characters.push(duplicate.characters[0]);
    const ambiguous = configuration();
    ambiguous.grants.push({ ...ambiguous.grants[0], id: 'second-grant' });
    const duplicateResidency = configuration();
    duplicateResidency.residencies.push({
      ...duplicateResidency.residencies[0],
      worldId: 'elsewhere-two',
    });
    for (const config of [wrongOwner, duplicate, ambiguous, duplicateResidency])
      expect(() => new HostResourceRegistry(config)).toThrow('invalid or ambiguous');
  });
  it('does not mutate previously valid policy when a replacement fails', () => {
    const registry = new HostResourceRegistry(configuration());
    expect(() => registry.replace({ characters: [] })).toThrow();
    expect(registry.resolve(scope, now).decision).toBe('eligible');
  });
  it('creates the sole-resident inference policy without exposing secrets or owner overrides', () => {
    const registry = createSoleHubertRegistry({
      ownerUserId: 'owner-a',
      connectionId: 'owner-a-model',
      provider: 'openai.chatgpt',
    });
    expect(registry.resolve(scope, now).decision).toBe('eligible');
    expect(registry.resolve({ ...scope, characterId: 'another' }, now).decision).toBe('denied');
  });
});
