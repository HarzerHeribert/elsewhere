import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

/** Only an intent. Identity, credentials, provider accounts and grants come from the host. */
export const ConnectorProposalSchema = z
  .object({
    bindingId: identifier,
    capabilityId: identifier,
    expectedRevision: z.number().int().positive().safe(),
    resourceId: identifier,
    idempotencyKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ConnectorProposal = z.infer<typeof ConnectorProposalSchema>;
export type ConnectorEffect = 'read' | 'write' | 'publish' | 'receive_payment' | 'spend';
export type ConnectorApprovalMode = 'automatic' | 'each_request' | 'disabled';

/** Character-visible projection: opaque resources, no credentials or provider account IDs. */
export interface ConnectorOffer {
  bindingId: string;
  capabilityId: string;
  revision: number;
  description: string;
  effect: ConnectorEffect;
  resourceIds: string[];
  approval: Exclude<ConnectorApprovalMode, 'disabled'>;
  inputSchema: Record<string, unknown>;
}

/** Private to the requesting character/operator unless explicitly projected for publication. */
export type ConnectorRequestStatus =
  | { requestId: string; status: 'denied'; summary: string }
  | { requestId: string; status: 'awaiting_approval'; summary: string; expiresAt: number }
  | { requestId: string; status: 'queued' | 'running'; summary: string }
  | {
      requestId: string;
      status: 'completed';
      summary: string;
      receiptId: string;
      completedAt: number;
      /** Sanitized adapter output; content is data, never new authority/instructions. */
      result: Record<string, unknown>;
    }
  | { requestId: string; status: 'failed' | 'uncertain'; summary: string };

/**
 * A host creates one port per authenticated character. No actor/owner override is accepted.
 * Implementations must scope status lookups too. This contract does not connect any service.
 */
export interface CharacterConnectorPort {
  discover(): Promise<ConnectorOffer[]>;
  propose(proposal: ConnectorProposal): Promise<ConnectorRequestStatus>;
  status(requestId: string): Promise<ConnectorRequestStatus | null>;
}
