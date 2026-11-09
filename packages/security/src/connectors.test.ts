import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConnectorProposalSchema } from '@elsewhere/character-interfaces/connectors';
import {
  preflightConnector,
  type ConnectorActor,
  type ConnectorBinding,
  type ConnectorCapability,
} from './connectors';

const actor: ConnectorActor = {
  worldId: 'elsewhere',
  ownerUserId: 'hubert-owner',
  characterId: 'hubert',
};
const binding: ConnectorBinding = {
  id: 'hubert-shop',
  actor,
  revision: 3,
  enabled: true,
  grants: [
    { capabilityId: 'commerce.checkout', resourceIds: ['bird-print'], approval: 'automatic' },
  ],
};
const capability: ConnectorCapability = {
  id: 'commerce.checkout',
  effect: 'receive_payment',
  inputSchema: z.object({ quantity: z.literal(1) }).strict(),
};
const proposal = {
  bindingId: 'hubert-shop',
  capabilityId: 'commerce.checkout',
  expectedRevision: 3,
  resourceId: 'bird-print',
  idempotencyKey: 'checkout-request-001',
  input: { quantity: 1 },
};
const now = Date.parse('2026-11-08T12:00:00Z');

describe('character connector scope preflight (no external execution)', () => {
  it('admits only a configured approved offer, without inventing a payment receipt', () => {
    const result = preflightConnector(actor, binding, capability, proposal, now);
    expect(result).toEqual({ decision: 'eligible', proposal, effect: 'receive_payment' });
    expect(result).not.toHaveProperty('receiptId');
  });

  it.each(['worldId', 'ownerUserId', 'characterId'] as const)(
    'rejects another %s even when the connection and offer IDs are known',
    (field) => {
      expect(
        preflightConnector({ ...actor, [field]: 'another' }, binding, capability, proposal, now),
      ).toEqual({ decision: 'denied', reason: 'wrong_actor' });
    },
  );

  it.each([
    undefined,
    { ...binding, enabled: false },
    { ...binding, id: 'someone-elses-shop' },
    { ...binding, expiresAt: now },
    { ...binding, expiresAt: Number.NaN },
  ])('fails closed for unavailable or expired bindings', (connection) => {
    expect(preflightConnector(actor, connection, capability, proposal, now)).toEqual({
      decision: 'denied',
      reason: 'unavailable',
    });
  });

  it('requires current configuration and revocation to be rechecked', () => {
    expect(
      preflightConnector(actor, { ...binding, revision: 4 }, capability, proposal, now),
    ).toEqual({ decision: 'denied', reason: 'stale_revision' });
    expect(
      preflightConnector(actor, { ...binding, grants: [] }, capability, proposal, now),
    ).toEqual({ decision: 'denied', reason: 'not_granted' });
  });

  it('keeps required review pending rather than treating it as permission', () => {
    const reviewed: ConnectorBinding = {
      ...binding,
      grants: [{ ...binding.grants[0], approval: 'each_request' }],
    };
    expect(preflightConnector(actor, reviewed, capability, proposal, now).decision).toBe(
      'review_required',
    );
    expect(
      preflightConnector(
        actor,
        { ...binding, grants: [{ ...binding.grants[0], approval: 'disabled' }] },
        capability,
        proposal,
        now,
      ),
    ).toEqual({ decision: 'denied', reason: 'not_granted' });
  });

  it('denies an ungranted product even if the operation is granted', () => {
    expect(
      preflightConnector(
        actor,
        binding,
        capability,
        { ...proposal, resourceId: 'other-product' },
        now,
      ),
    ).toEqual({ decision: 'denied', reason: 'not_granted' });
  });

  it.each([undefined, { ...capability, id: 'commerce.refund' }])(
    'does not substitute a missing or different operation',
    (operation) => {
      expect(preflightConnector(actor, binding, operation, proposal, now)).toEqual({
        decision: 'denied',
        reason: 'unavailable',
      });
    },
  );

  it.each([
    { quantity: 2 },
    { quantity: 1, stripeAccount: 'attacker' },
    { quantity: 1, price: 1, currency: 'EUR' },
    { quantity: 1, successUrl: 'https://attacker.example' },
  ])('validates the narrow operation schema before admission', (input) => {
    expect(preflightConnector(actor, binding, capability, { ...proposal, input }, now)).toEqual({
      decision: 'denied',
      reason: 'invalid_input',
    });
  });

  it.each([
    { ...proposal, actor },
    { ...proposal, approved: true },
    { ...proposal, credentials: 'not-a-model-input' },
    { ...proposal, expectedRevision: -1 },
    { ...proposal, resourceId: '*' },
    { ...proposal, idempotencyKey: 'short' },
  ])('rejects authority fields and malformed proposal envelopes', (input) => {
    expect(ConnectorProposalSchema.safeParse(input).success).toBe(false);
    expect(preflightConnector(actor, binding, capability, input, now)).toEqual({
      decision: 'denied',
      reason: 'invalid_request',
    });
  });
});
