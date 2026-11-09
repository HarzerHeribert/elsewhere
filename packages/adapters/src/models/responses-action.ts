import { z } from 'zod';
import { CharacterCommandSchema, MODEL_ACTION_FORMAT } from '@elsewhere/character-interfaces';
import { InvalidDecisionError, invalidDecisionFields } from '@elsewhere/character-runtime';

type ObjectFormat = {
  type: string;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

/** Strict Responses schemas require every property. Split optional fields into complete
 * alternatives rather than weakening the canonical parser or inventing default values. */
function completeAlternatives(format: ObjectFormat): ObjectFormat[] {
  const required = new Set(format.required);
  const optional = Object.keys(format.properties).filter((key) => !required.has(key));
  if (optional.length > 3) throw new Error('Action format has too many optional alternatives.');
  return Array.from({ length: 2 ** optional.length }, (_, selection) => {
    const keys = Object.keys(format.properties).filter(
      (key) => required.has(key) || !!(selection & (1 << optional.indexOf(key))),
    );
    return {
      ...format,
      properties: Object.fromEntries(keys.map((key) => [key, format.properties[key]])),
      required: keys,
    };
  });
}

/** OpenAI disallows root anyOf. Only this transport uses a one-property envelope;
 * the command inside remains the shared, provider-agnostic action vocabulary. */
export const RESPONSES_ACTION_FORMAT = {
  type: 'json_schema',
  name: 'character_action_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        anyOf: MODEL_ACTION_FORMAT.anyOf.flatMap((format) =>
          completeAlternatives(format as ObjectFormat),
        ),
      },
    },
  },
} as const;

const responseSchema = z.object({ action: CharacterCommandSchema }).strict();

/** No repair, text extraction, generated fallback, or promotion of partial deltas. */
export function parseResponsesAction(content: string) {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new InvalidDecisionError('invalid_json');
  }
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success)
    throw new InvalidDecisionError('invalid_action', invalidDecisionFields(parsed.error));
  return parsed.data.action;
}
