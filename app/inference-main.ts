import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { inferenceConfig } from './inference-config';
import { hubertInferenceBinding, hubertResourceRegistry } from './residency';
import {
  createInferenceBroker,
  InferenceDispatchError,
  type InferenceBrokerState,
} from '../packages/inference/src/index';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { ChatGPTSession } from '../packages/security/src/chatgpt';
import { ChatGPTStore } from '../packages/security/src/chatgpt-store';
import { ChatGPTClient } from '../packages/adapters/src/models/chatgpt';
import { decisionMessages, parseModelAction } from '../packages/adapters/src/models/shared';
import {
  reflectionMessages,
  validateReflectionProposal,
  type ReflectionInput,
} from '../packages/adapters/src/models/reflection';
import type { DecisionContext } from '@elsewhere/character-runtime';
import { InvalidDecisionError } from '@elsewhere/character-runtime';
import {
  InferenceDiagnosticSchema,
  type InferenceDiagnostic,
} from '../packages/inference/src/contracts';
import type { ModelUsage } from '../packages/models/src/contracts';
import { HUBERT_IDENTITY } from '../characters/hubert/src/persona';
import {
  expressionMessages,
  validatePublicExpression,
} from '../packages/adapters/src/models/expression';
import { createUnconfiguredInferenceService } from '../packages/inference/src/unconfigured';

// No dotenv discovery: this process receives only its own explicitly installed secrets.
process.umask(0o077);
let broker: Pick<Awaited<ReturnType<typeof createInferenceBroker>>, 'server' | 'close'> | undefined;
let stopping = false;
try {
  const config = inferenceConfig(process.env);
  mkdirSync(config.INFERENCE_DATA_ROOT, { recursive: true, mode: 0o700 });
  const credentials = new ChatGPTStore(config.INFERENCE_DATA_ROOT, config.CHATGPT_PROFILE);
  await credentials.hostId(); // Stable remote-host identity exists before importing a session.
  const session = new ChatGPTSession(credentials);
  let usage: ModelUsage | undefined;
  const client = new ChatGPTClient(session, {
    model: config.MODEL_NAME,
    timeoutMs: config.MODEL_TIMEOUT_MS,
    onUsageDetails: (value) => {
      usage = value;
    },
  });
  const dispatch = async (input: DecisionContext | ReflectionInput, signal: AbortSignal) => {
    usage = undefined;
    let text: string | undefined;
    const dream = 'episodes' in input;
    try {
      text = await client.text(dream ? reflectionMessages(input) : decisionMessages(input), signal);
      const value = dream
        ? validateReflectionProposal(
            JSON.parse(
              text
                .trim()
                .replace(/^```(?:json)?\s*/, '')
                .replace(/\s*```$/, ''),
            ),
            input,
          )
        : parseModelAction(text);
      return { value, usage };
    } catch (error) {
      let diagnostic: InferenceDiagnostic;
      if (error instanceof InvalidDecisionError)
        diagnostic = {
          code: error.code === 'invalid_json' ? 'invalid_json' : 'invalid_action',
          fields: error.fields,
        };
      else if (text !== undefined && dream) diagnostic = { code: 'invalid_reflection', fields: [] };
      else {
        const candidate = {
          code: 'provider_response',
          fields: [],
          providerCode: (error as { code?: unknown })?.code,
        };
        const parsed = InferenceDiagnosticSchema.safeParse(candidate);
        diagnostic = parsed.success ? parsed.data : { code: 'provider_response', fields: [] };
      }
      throw new InferenceDispatchError(usage, diagnostic);
    }
  };
  const ownerUserId = config.HUBERT_OWNER_USER_ID;
  broker = ownerUserId
    ? await createInferenceBroker({
        token: config.INFERENCE_BROKER_TOKEN,
        binding: hubertInferenceBinding(ownerUserId),
        registry: hubertResourceRegistry(ownerUserId),
        identity: HUBERT_IDENTITY,
        store: new SqliteSnapshotStore<InferenceBrokerState>(
          resolve(credentials.directory, 'allowance.sqlite'),
        ),
        maxCallsPerDay: config.MODEL_MAX_CALLS_PER_DAY,
        tokenBudget: {
          maxInputTokensPerDay: config.MODEL_MAX_INPUT_TOKENS_PER_DAY,
          maxOutputTokensPerDay: config.MODEL_MAX_OUTPUT_TOKENS_PER_DAY,
          maxInputTokensPerRequest: config.MODEL_MAX_INPUT_TOKENS_PER_REQUEST,
          outputTokenReserve: config.MODEL_OUTPUT_TOKEN_RESERVE,
          maxUnknownUsageCallsPerDay: config.MODEL_MAX_UNKNOWN_USAGE_CALLS_PER_DAY,
        },
        requestBodyTimeoutMs: config.MODEL_REQUEST_BODY_TIMEOUT_MS,
        timeoutMs: Math.min(60000, config.MODEL_TIMEOUT_MS + 5000),
        isAvailable: () => {
          const account = credentials.load();
          return (
            session.isAvailable() &&
            account?.transfer?.state === 'received' &&
            account.transfer.ownerUserId === config.HUBERT_OWNER_USER_ID
          );
        },
        decision: dispatch,
        reflection: dispatch,
        expression: async (input, signal, onDelta) => {
          usage = undefined;
          try {
            const text = await client.text(
              expressionMessages(HUBERT_IDENTITY, input),
              signal,
              onDelta,
            );
            return { value: text, usage };
          } catch {
            throw new InferenceDispatchError(usage);
          }
        },
      })
    : createUnconfiguredInferenceService(config.INFERENCE_BROKER_TOKEN);
  const close = async () => {
    if (stopping) return;
    stopping = true;
    await broker?.close();
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  await new Promise<void>((resolve, reject) => {
    broker!.server.once('error', reject);
    broker!.server.listen(config.PORT, config.HOST, resolve);
  });
  console.log(
    `Private Hubert inference service listening on port ${config.PORT}. Missing authorization keeps inference disabled.`,
  );
} catch {
  console.error(
    'Private inference startup failed. Check its dedicated configuration, storage and ownership binding.',
  );
  await broker?.close();
  process.exitCode = 1;
}
