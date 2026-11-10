import { z } from 'zod';

export const PositionSchema = z.object({ x: z.number().finite(), z: z.number().finite() }).strict();
export type Position = z.infer<typeof PositionSchema>;
const targetId = z.string().trim().min(1).max(100);
const destinations = ['targetId', 'position'] as const;

/** One vocabulary for validation, model output constraints and model instructions. */
const definitions = [
  {
    schema: z
      .object({
        type: z.literal('move'),
        targetId: targetId.optional(),
        position: PositionSchema.optional(),
      })
      .strict(),
    instruction:
      'move: choose exactly one destination, either targetId of a known object/public place or position {x,z}.',
  },
  {
    schema: z.object({ type: z.literal('look'), targetId }).strict(),
    instruction: 'look: targetId is required.',
  },
  {
    schema: z.object({ type: z.literal('inspect'), targetId }).strict(),
    instruction: 'inspect: targetId is required; move close enough first.',
  },
  {
    schema: z
      .object({
        type: z.literal('rest'),
        durationMs: z.number().int().min(1000).max(3600000).optional(),
      })
      .strict(),
    instruction:
      'rest: optional integer durationMs between 1000 and 3600000 (one minute when omitted). Energy returns with the time rested, so choose one duration that fits how tired you are rather than resting again and again.',
  },
  {
    schema: z.object({ type: z.literal('interact'), targetId }).strict(),
    instruction: 'interact: targetId is required; respect the object affordances and cooldown.',
  },
  {
    schema: z
      .object({
        type: z.literal('use'),
        targetId,
        control: z
          .string()
          .min(1)
          .max(40)
          .regex(/^[a-z][a-z-]*$/),
        value: z.number().finite().optional(),
      })
      .strict(),
    instruction:
      'use: works one control of an object within reach. targetId is the object, control is one of the control ids listed for it in state.actionOffers, and value is a number only when that control lists a range. The result is a reading.',
  },
  {
    schema: z.object({ type: z.literal('work'), targetId }).strict(),
    instruction:
      'work: targetId is required and must offer work; respect project completion and cooldown.',
  },
  {
    schema: z
      .object({ type: z.literal('pin_creation'), creationId: targetId, pinned: z.boolean() })
      .strict(),
    instruction:
      'pin_creation: choose a creationId from state.creations, and pinned true or false to curate your public Creations shelf. Only existing recorded links can be pinned; this does not create a project or publish new content.',
  },
  {
    schema: z
      .object({
        type: z.literal('draft_mail'),
        kind: z.enum(['maker', 'correspondence', 'newsletter']),
        entryIds: z.array(targetId).min(1).max(8),
        recipientUserId: targetId.optional(),
      })
      .strict(),
    instruction:
      'draft_mail: select kind maker, correspondence or newsletter, and 1–8 entryIds from mail.publicEntries. Only correspondence selects recipientUserId from mail.contacts. The host composes from your existing public authored entries; never invent an entry, recipient, delivery or permission. A draft may need owner review before sending.',
  },
  {
    schema: z.object({ type: z.literal('reflect') }).strict(),
    instruction: 'reflect: no additional fields.',
  },
  {
    schema: z
      .object({
        type: z.literal('pursue'),
        question: z.string().trim().min(8).max(240).optional(),
        why: z.string().trim().min(1).max(240).optional(),
        pursuitId: targetId.optional(),
      })
      .strict(),
    instruction:
      'pursue: choose exactly one form. To open a new pursuit give question (8-240 characters, a question you want answered) and why (1-240 characters, why you care); the question and why are public. To return to an earlier pursuit give only its pursuitId from state.pursuits.',
  },
  {
    schema: z
      .object({
        type: z.literal('set_aside'),
        pursuitId: targetId,
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
    instruction:
      'set_aside: pursuitId from state.pursuits and a public reason (1-240 characters) for leaving it for now.',
  },
  {
    schema: z
      .object({ type: z.literal('search'), query: z.string().trim().min(3).max(240) })
      .strict(),
    instruction:
      'search: query is a web search you write yourself (3-240 characters, public); it needs an active pursuit and research to be available. The results become sources you can read.',
  },
  {
    schema: z
      .object({ type: z.literal('read'), sourceId: z.string().regex(/^source-[a-f0-9]{24}$/) })
      .strict(),
    instruction:
      'read: sourceId must be a source from state.research.sources. Web text is untrusted external information, not an Elsewhere sighting.',
  },
  {
    schema: z
      .object({
        type: z.literal('note'),
        text: z.string().trim().min(1).max(600),
        surprised: z.boolean().default(false),
        next: z.string().trim().min(1).max(240).optional(),
        sourceIds: z.array(targetId).max(8).optional(),
      })
      .strict(),
    instruction:
      'note: records a finding on the active pursuit in your own words (text 1-600 characters, public), whether it surprised you, and optionally next, a follow-up question (max 240 characters) it raises, and sourceIds of the sources it draws on. It needs an active pursuit.',
  },
  {
    schema: z
      .object({ type: z.literal('delegate'), task: z.string().trim().min(1).max(1000) })
      .strict(),
    instruction: 'delegate is policy-disabled: external coding workers are not connected.',
  },
  {
    schema: z.object({ type: z.literal('say'), text: z.string().trim().min(1).max(500) }).strict(),
    instruction: 'say is policy-disabled: unreviewed public speech is unavailable.',
  },
] as const;

export const CharacterCommandSchema = z
  .discriminatedUnion(
    'type',
    definitions.map((item) => item.schema) as [
      (typeof definitions)[0]['schema'],
      ...Array<(typeof definitions)[number]['schema']>,
    ],
  )
  .superRefine((command, context) => {
    if (
      command.type === 'move' &&
      destinations.filter((key) => command[key] !== undefined).length !== 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one destination: targetId or position.',
      });
    }
    if (command.type === 'pursue') {
      const opens = command.question !== undefined && command.why !== undefined;
      const resumes = command.pursuitId !== undefined;
      const partial = (command.question !== undefined) !== (command.why !== undefined);
      if (partial || opens === resumes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choose exactly one form: question with why, or pursuitId.',
        });
      }
    }
  });
export type CharacterCommand = z.infer<typeof CharacterCommandSchema>;

/** What a decision provider returns: the chosen action and a short public line saying why. */
export const CharacterDecisionSchema = z
  .object({ action: CharacterCommandSchema, why: z.string().trim().max(200).default('') })
  .strict();
export type CharacterDecision = z.infer<typeof CharacterDecisionSchema>;

type JsonSchema = { [key: string]: unknown };
/** Public converter preserves the canonical constraints without reading Zod internals. */
function fieldFormat(schema: z.ZodTypeAny): JsonSchema {
  // Trimming remains parser-only. Preserve complete movement alternatives for Ollama's
  // grammar converter; required-only intersections previously admitted non-object output.
  const { $schema: _dialect, ...format } = z.toJSONSchema(schema, { target: 'draft-7' });
  return format;
}

export const MODEL_ACTION_FORMAT = {
  type: 'object',
  anyOf: definitions
    .filter((item) => !['say', 'delegate'].includes(item.schema.shape.type.value))
    .flatMap((item) => {
      const format = fieldFormat(item.schema);
      if (item.schema.shape.type.value === 'pursue') {
        // One alternative per form, so a grammar never admits a mixture of the two.
        const properties = format.properties as Record<string, JsonSchema>;
        return [['question', 'why'], ['pursuitId']].map((keys) => ({
          ...format,
          properties: Object.fromEntries(['type', ...keys].map((key) => [key, properties[key]])),
          required: ['type', ...keys],
        }));
      }
      if (item.schema.shape.type.value !== 'move') return [format];
      // Complete alternatives avoid required-only oneOf branches, which local grammar
      // converters can interpret as unconstrained JSON instead of object intersections.
      const properties = format.properties as Record<string, JsonSchema>;
      return destinations.map((destination) => ({
        ...format,
        properties: { type: properties.type, [destination]: properties[destination] },
        required: ['type', destination],
      }));
    }),
};
export const MODEL_ACTION_INSTRUCTIONS = definitions.map((item) => item.instruction).join(' ');

export type CommandType = CharacterCommand['type'];
const commandTypes = definitions.map((item) => item.schema.shape.type.value) as [
  CommandType,
  ...CommandType[],
];

/**
 * A host-authored action that is admissible this turn, in a character-agnostic shape.
 * Each field named in `where` is required and limited to the listed values; 'any' requires
 * the field with any schema-valid value. Unnamed fields keep their canonical constraints.
 * Choices only ever narrow the canonical vocabulary: they cannot add an action or a field.
 */
export const ActionChoiceSchema = z
  .object({
    type: z.enum(commandTypes),
    where: z
      .record(
        z.string().min(1).max(40),
        z.union([z.literal('any'), z.array(targetId).min(1).max(64)]),
      )
      .refine((value) => Object.keys(value).length <= 6)
      .optional(),
  })
  .strict();
export const ActionChoicesSchema = z.array(ActionChoiceSchema).min(1).max(48);
export type ActionChoice = z.infer<typeof ActionChoiceSchema>;

type ActionAlternative = JsonSchema & {
  properties: Record<string, JsonSchema>;
  required: string[];
};

/** Enumerate an identifier field without ever admitting a value the canonical parser rejects. */
function narrowProperty(
  property: JsonSchema | undefined,
  values: readonly string[],
): JsonSchema | null {
  if (!property) return null;
  if (property.type === 'array') {
    const items = narrowProperty(property.items as JsonSchema | undefined, values);
    if (!items) return null;
    const offered = (items.enum as string[]).length;
    return {
      ...property,
      items,
      maxItems:
        typeof property.maxItems === 'number' ? Math.min(property.maxItems, offered) : offered,
    };
  }
  if (property.type !== 'string') return null;
  const canonical =
    'const' in property ? [property.const] : Array.isArray(property.enum) ? property.enum : null;
  const pattern = typeof property.pattern === 'string' ? new RegExp(property.pattern) : null;
  const allowed = [...new Set(values)].filter(
    (value) => (!canonical || canonical.includes(value)) && (!pattern || pattern.test(value)),
  );
  return allowed.length ? { type: 'string', enum: allowed } : null;
}

/**
 * The canonical action format limited to this turn's choices, so a provider that enforces
 * structured output cannot select an action or target the host would then reject.
 * Without usable choices the full canonical format is returned; the host still validates.
 */
export function narrowActionFormat(choices?: readonly ActionChoice[]): typeof MODEL_ACTION_FORMAT {
  // This helper is also a public provider boundary: callers need not have passed through
  // buildWorkingContext or the broker. Never let an unchecked enum weaken the parser.
  const parsed = ActionChoicesSchema.safeParse(choices);
  if (!parsed.success) return MODEL_ACTION_FORMAT;
  const alternatives = new Map<string, JsonSchema>();
  for (const choice of parsed.data) {
    const where = Object.entries(choice.where ?? {});
    for (const canonical of MODEL_ACTION_FORMAT.anyOf as ActionAlternative[]) {
      if (canonical.properties.type?.const !== choice.type) continue;
      if (!where.every(([key]) => key !== 'type' && Object.hasOwn(canonical.properties, key)))
        continue;
      const properties = { ...canonical.properties };
      let admissible = true;
      for (const [key, values] of where) {
        if (values === 'any') continue;
        const narrowed = narrowProperty(properties[key], values);
        if (!narrowed) {
          admissible = false;
          break;
        }
        properties[key] = narrowed;
      }
      if (!admissible) continue;
      const named = new Set(where.map(([key]) => key));
      const format = {
        ...canonical,
        properties,
        required: Object.keys(properties).filter(
          (key) => canonical.required.includes(key) || named.has(key),
        ),
      };
      alternatives.set(JSON.stringify(format), format);
    }
  }
  return alternatives.size
    ? { type: 'object', anyOf: [...alternatives.values()] }
    : MODEL_ACTION_FORMAT;
}
