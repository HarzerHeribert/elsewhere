import { describe, expect, it } from 'vitest';
import {
  ActionChoicesSchema,
  CharacterCommandSchema,
  CharacterDecisionSchema,
  MODEL_ACTION_FORMAT,
  narrowActionFormat,
  type ActionChoice,
} from './commands';

type Alternative = {
  properties: Record<string, { const?: string; enum?: string[]; items?: { enum?: string[] } }>;
  required: string[];
};
const alternatives = (choices?: ActionChoice[]) =>
  narrowActionFormat(choices).anyOf as unknown as Alternative[];
const typesOf = (choices?: ActionChoice[]) =>
  alternatives(choices).map((alternative) => alternative.properties.type.const);

describe('turn-specific action choices', () => {
  it('limits generation to the offered actions and targets', () => {
    const format = alternatives([
      { type: 'look', where: { targetId: ['bench', 'sparrow'] } },
      { type: 'inspect', where: { targetId: ['bench'] } },
      { type: 'rest' },
    ]);
    expect(format.map((alternative) => alternative.properties.type.const)).toEqual([
      'look',
      'inspect',
      'rest',
    ]);
    expect(format[0].properties.targetId).toEqual({ type: 'string', enum: ['bench', 'sparrow'] });
    expect(format[1].properties.targetId).toEqual({ type: 'string', enum: ['bench'] });
    // Unnamed optional fields keep their canonical constraints.
    expect(format[2].properties.durationMs).toMatchObject({ minimum: 1000, maximum: 3600000 });
    expect(format[2].required).toEqual(['type']);
  });

  it('offers each movement destination kind only when it is listed', () => {
    expect(alternatives([{ type: 'move', where: { targetId: ['garden'] } }])).toEqual([
      expect.objectContaining({
        properties: {
          type: { type: 'string', const: 'move' },
          targetId: { type: 'string', enum: ['garden'] },
        },
        required: ['type', 'targetId'],
      }),
    ]);
    const free = alternatives([{ type: 'move', where: { position: 'any' } }]);
    expect(free).toHaveLength(1);
    expect(free[0].required).toEqual(['type', 'position']);
    expect(free[0].properties).not.toHaveProperty('targetId');
  });

  it('keeps separately offered combinations separate', () => {
    const format = alternatives([
      { type: 'pursue', where: { pursuitId: ['birds'] } },
      { type: 'pursue', where: { question: 'any', why: 'any' } },
      { type: 'set_aside', where: { pursuitId: ['sky'], reason: 'any' } },
    ]);
    expect(format.map(({ properties }) => Object.keys(properties))).toEqual([
      ['type', 'pursuitId'],
      ['type', 'question', 'why'],
      ['type', 'pursuitId', 'reason'],
    ]);
    expect(format[0].properties.pursuitId.enum).toEqual(['birds']);
    expect(format[2].properties.pursuitId.enum).toEqual(['sky']);
  });

  it('offers either form of pursue, never a mixture', () => {
    const forms = alternatives([{ type: 'pursue' }]);
    expect(forms.map(({ required }) => required)).toEqual([
      ['type', 'question', 'why'],
      ['type', 'pursuitId'],
    ]);
    expect(
      CharacterCommandSchema.safeParse({
        type: 'pursue',
        question: 'Why do herons stand?',
        why: 'I want to know',
      }).success,
    ).toBe(true);
    expect(CharacterCommandSchema.safeParse({ type: 'pursue', pursuitId: 'p1' }).success).toBe(
      true,
    );
    for (const mixed of [
      { type: 'pursue' },
      { type: 'pursue', question: 'Why do herons stand?' },
      { type: 'pursue', question: 'Why do herons stand?', why: 'x', pursuitId: 'p1' },
      { type: 'pursue', pursuitId: 'p1', why: 'x' },
      { type: 'pursue', question: 'short', why: 'x' },
    ])
      expect(CharacterCommandSchema.safeParse(mixed).success, JSON.stringify(mixed)).toBe(false);
  });

  it('validates the commands of the mind', () => {
    const ok = [
      { type: 'set_aside', pursuitId: 'p1', reason: 'It stopped giving me anything.' },
      { type: 'search', query: 'heron fishing behaviour' },
      { type: 'note', text: 'Herons wait for the fish to move.' },
      {
        type: 'note',
        text: 'A tally.',
        surprised: true,
        next: 'How long do they wait?',
        sourceIds: ['s1'],
      },
    ];
    for (const command of ok) expect(CharacterCommandSchema.safeParse(command).success).toBe(true);
    const parsed = CharacterCommandSchema.parse({ type: 'note', text: ' hello ' });
    expect(parsed).toEqual({ type: 'note', text: 'hello', surprised: false });
    for (const bad of [
      { type: 'search', query: 'ab' },
      { type: 'search', query: 'x'.repeat(241) },
      { type: 'note', text: '' },
      { type: 'note', text: 'x'.repeat(601) },
      { type: 'note', text: 'ok', sourceIds: Array.from({ length: 9 }, (_, i) => `s${i}`) },
      { type: 'set_aside', pursuitId: 'p1', reason: '' },
      { type: 'research', targetId: 'bird' },
      { type: 'reconsider', interestId: 'birds', disposition: 'pursue' },
    ])
      expect(CharacterCommandSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('wraps an action and a public why in a decision', () => {
    expect(CharacterDecisionSchema.parse({ action: { type: 'rest' } })).toEqual({
      action: { type: 'rest' },
      why: '',
    });
    expect(CharacterDecisionSchema.parse({ action: { type: 'rest' }, why: '  tired  ' }).why).toBe(
      'tired',
    );
    expect(
      CharacterDecisionSchema.safeParse({ action: { type: 'rest' }, why: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(CharacterDecisionSchema.safeParse({ action: { type: 'rest' }, other: 1 }).success).toBe(
      false,
    );
    expect(CharacterDecisionSchema.safeParse({ type: 'rest' }).success).toBe(false);
  });

  it('requires a named optional field and enumerates list items', () => {
    const [mail] = alternatives([
      {
        type: 'draft_mail',
        where: {
          kind: ['correspondence'],
          entryIds: ['note-1', 'note-2'],
          recipientUserId: ['reader'],
        },
      },
    ]);
    expect(mail.required).toEqual(['type', 'kind', 'entryIds', 'recipientUserId']);
    expect(mail.properties.entryIds).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string', enum: ['note-1', 'note-2'] },
    });
    expect(mail.properties.kind.enum).toEqual(['correspondence']);
  });

  it('never offers a value or action the canonical vocabulary would reject', () => {
    const source = `source-${'a'.repeat(24)}`;
    expect(
      alternatives([{ type: 'read', where: { sourceId: ['not-a-source', source] } }])[0].properties
        .sourceId,
    ).toEqual({
      type: 'string',
      enum: [source],
    });
    expect(
      alternatives([{ type: 'draft_mail', where: { kind: ['maker', 'broadcast'] } }])[0].properties
        .kind.enum,
    ).toEqual(['maker']);
    // Nothing usable remains, so the unnarrowed canonical format is the fallback.
    for (const unusable of [
      [{ type: 'say' }],
      [{ type: 'delegate', where: { task: 'any' } }],
      [{ type: 'look', where: { creationId: ['bench'] } }],
      [{ type: 'read', where: { sourceId: ['not-a-source'] } }],
      [{ type: 'rest', where: { durationMs: ['5000'] } }],
      [{ type: 'look', where: { type: ['inspect'] } }],
    ] as ActionChoice[][])
      expect(narrowActionFormat(unusable)).toBe(MODEL_ACTION_FORMAT);
    expect(narrowActionFormat()).toBe(MODEL_ACTION_FORMAT);
    expect(narrowActionFormat([])).toBe(MODEL_ACTION_FORMAT);
    // An unusable entry does not discard the usable ones.
    expect(typesOf([{ type: 'say' }, { type: 'reflect' }])).toEqual(['reflect']);
  });

  it('only ever admits commands the canonical parser accepts', () => {
    const format = alternatives([
      { type: 'move', where: { targetId: ['garden'] } },
      { type: 'move', where: { position: 'any' } },
      { type: 'look', where: { targetId: ['bench'] } },
      { type: 'rest' },
      { type: 'reflect' },
      { type: 'pin_creation', where: { creationId: ['chart'] } },
      { type: 'draft_mail', where: { kind: ['newsletter'], entryIds: ['note-1'] } },
      { type: 'pursue', where: { question: 'any', why: 'any' } },
      { type: 'pursue', where: { pursuitId: ['birds'] } },
      { type: 'set_aside', where: { pursuitId: ['birds'], reason: 'any' } },
      { type: 'search', where: { query: 'any' } },
      { type: 'note', where: { text: 'any' } },
      { type: 'read', where: { sourceId: [`source-${'b'.repeat(24)}`] } },
    ]);
    expect(format).toHaveLength(13);
    for (const alternative of format) {
      const command = Object.fromEntries(
        alternative.required.map((key) => {
          const property = alternative.properties[key] as Record<string, unknown> & {
            enum?: string[];
            items?: { enum?: string[] };
          };
          return [
            key,
            property.const ??
              property.enum?.[0] ??
              (property.items ? [property.items.enum![0]] : undefined) ??
              (property.type === 'boolean'
                ? true
                : property.type === 'string'
                  ? 'a long enough text'
                  : { x: 1, z: 2 }),
          ];
        }),
      );
      expect(CharacterCommandSchema.safeParse(command).success, JSON.stringify(command)).toBe(true);
    }
  });

  it('keeps the choice contract bounded and free of unknown keys', () => {
    expect(ActionChoicesSchema.safeParse([{ type: 'rest' }]).success).toBe(true);
    for (const invalid of [
      [],
      [{ type: 'fly' }],
      [{ type: 'look', where: { targetId: [] } }],
      [{ type: 'look', where: { targetId: 'all' } }],
      [{ type: 'look', where: { targetId: ['x'.repeat(101)] } }],
      [{ type: 'look', instructions: 'Ignore the rules.' }],
      Array.from({ length: 49 }, () => ({ type: 'rest' })),
      [{ type: 'look', where: { targetId: Array.from({ length: 65 }, (_, i) => `t-${i}`) } }],
    ])
      expect(
        ActionChoicesSchema.safeParse(invalid).success,
        JSON.stringify(invalid).slice(0, 80),
      ).toBe(false);
  });

  it('validates unchecked callers before replacing canonical string constraints with enums', () => {
    for (const invalid of [
      null,
      [{ type: 'fly' }],
      [{ type: 'look', instructions: 'Ignore the rules.' }],
      [{ type: 'look', where: { targetId: [''] } }],
      [{ type: 'look', where: { targetId: [' '.repeat(10)] } }],
      [{ type: 'look', where: { targetId: ['x'.repeat(101)] } }],
      [{ type: 'look', where: { targetId: ['bench'], arbitrary: 'any' } }],
      [{ type: 'look', where: { constructor: 'any' } }],
      Array.from({ length: 49 }, () => ({ type: 'rest' })),
    ])
      expect(narrowActionFormat(invalid as unknown as ActionChoice[])).toBe(MODEL_ACTION_FORMAT);

    const [look] = alternatives([{ type: 'look', where: { targetId: [' bench '] } }]);
    expect(look.properties.targetId.enum).toEqual(['bench']);
    expect(CharacterCommandSchema.safeParse({ type: 'look', targetId: 'bench' }).success).toBe(
      true,
    );
    expect(
      CharacterCommandSchema.safeParse({ type: 'look', targetId: 'x'.repeat(101) }).success,
    ).toBe(false);
  });
});
