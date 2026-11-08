import { z } from 'zod';
import {
  ConnectorProposalSchema,
  type ConnectorApprovalMode,
  type ConnectorEffect,
  type ConnectorProposal,
} from '@elsewhere/character-interfaces/connectors';

/** Constructed by authenticated host code, never from a model/HTTP payload. */
export interface ConnectorActor {
  worldId: string;
  operatorId: string;
  characterId: string;
}

/** Host-only configuration. Provider credentials/resource mappings live behind the adapter. */
export interface ConnectorBinding {
  id: string;
  actor: ConnectorActor;
  revision: number;
  enabled: boolean;
  expiresAt?: number;
  grants: Array<{
    capabilityId: string;
    resourceIds: string[];
    approval: ConnectorApprovalMode;
  }>;
}

/** Registration is trusted code; all inputs still need an operation-specific strict schema. */
export interface ConnectorCapability {
  id: string;
  effect: ConnectorEffect;
  inputSchema: z.ZodType<Record<string, unknown>>;
}

export type ConnectorPreflight =
  | {
      decision: 'denied';
      reason:
        | 'invalid_request'
        | 'unavailable'
        | 'wrong_actor'
        | 'stale_revision'
        | 'not_granted'
        | 'invalid_input';
    }
  | {
      decision: 'eligible' | 'review_required';
      proposal: ConnectorProposal;
      effect: ConnectorEffect;
    };

/**
 * Scope/input preflight only, NOT execution authorization. A future broker must atomically
 * reserve quotas/budget, persist intent, obtain any exact-request approval and recheck grants
 * at dispatch. An eligible proposal cannot by itself cause external I/O.
 */
export function preflightConnector(
  actor: ConnectorActor,
  binding: ConnectorBinding | undefined,
  capability: ConnectorCapability | undefined,
  input: unknown,
  now: number,
): ConnectorPreflight {
  const parsed = ConnectorProposalSchema.safeParse(input);
  if (!parsed.success) return { decision: 'denied', reason: 'invalid_request' };
  const proposal = parsed.data;
  if (
    !Number.isFinite(now) ||
    !binding?.enabled ||
    binding.id !== proposal.bindingId ||
    !capability ||
    capability.id !== proposal.capabilityId ||
    (binding.expiresAt !== undefined &&
      (!Number.isFinite(binding.expiresAt) || binding.expiresAt <= now))
  )
    return { decision: 'denied', reason: 'unavailable' };
  if (
    binding.actor.worldId !== actor.worldId ||
    binding.actor.operatorId !== actor.operatorId ||
    binding.actor.characterId !== actor.characterId
  )
    return { decision: 'denied', reason: 'wrong_actor' };
  if (proposal.expectedRevision !== binding.revision)
    return { decision: 'denied', reason: 'stale_revision' };
  const grant = binding.grants.find((entry) => entry.capabilityId === capability.id);
  if (!grant || grant.approval === 'disabled' || !grant.resourceIds.includes(proposal.resourceId))
    return { decision: 'denied', reason: 'not_granted' };
  const payload = capability.inputSchema.safeParse(proposal.input);
  if (!payload.success) return { decision: 'denied', reason: 'invalid_input' };
  return {
    decision: grant.approval === 'each_request' ? 'review_required' : 'eligible',
    proposal: { ...proposal, input: payload.data },
    effect: capability.effect,
  };
}
