import { describe, expect, it } from 'vitest';
import {
  ActionChoicesSchema,
  CharacterCommandSchema,
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
      { type: 'reconsider', where: { interestId: ['birds'], disposition: ['set-aside'] } },
      { type: 'reconsider', where: { interestId: ['sky'], disposition: ['pursue'] } },
    ]);
    expect(
      format.map(({ properties }) => [properties.interestId.enum, properties.disposition.enum]),
    ).toEqual([
      [['birds'], ['set-aside']],
      [['sky'], ['pursue']],
    ]);
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
      { type: 'reconsider', where: { interestId: ['birds'], disposition: ['set-aside'] } },
      { type: 'research', where: { targetId: ['butterfly'] } },
      { type: 'read', where: { sourceId: [`source-${'b'.repeat(24)}`] } },
    ]);
    expect(format).toHaveLength(10);
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
              (property.type === 'boolean' ? true : { x: 1, z: 2 }),
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
