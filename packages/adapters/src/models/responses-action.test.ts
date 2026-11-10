import { describe, expect, it } from 'vitest';
import { MODEL_ACTION_FORMAT } from '@elsewhere/character-interfaces';
import { InvalidDecisionError } from '@elsewhere/character-runtime';
import { parseResponsesAction, RESPONSES_ACTION_FORMAT } from './responses-action';

describe('Responses decision generation boundary', () => {
  it('uses an OpenAI-compatible root object while keeping all canonical action alternatives', () => {
    const root = RESPONSES_ACTION_FORMAT.schema;
    expect(root.type).toBe('object');
    expect(root).not.toHaveProperty('anyOf');
    expect(root.required).toEqual(['action']);
    expect(root.additionalProperties).toBe(false);
    const alternatives = root.properties.action.anyOf;
    // Rest duration and a correspondence recipient each have absent/present complete branches.
    expect(alternatives).toHaveLength(MODEL_ACTION_FORMAT.anyOf.length + 2);
    expect(alternatives.map((item) => item.properties.type.const)).toEqual([
      'move',
      'move',
      'look',
      'inspect',
      'rest',
      'rest',
      'interact',
      'work',
      'pin_creation',
      'draft_mail',
      'draft_mail',
      'reflect',
      'research',
      'read',
      'reconsider',
    ]);
    for (const item of alternatives) {
      expect(item.required).toEqual(Object.keys(item.properties));
      expect(item.additionalProperties).toBe(false);
      const position = item.properties.position;
      if (position) {
        expect(position.required).toEqual(['x', 'z']);
        expect(position.additionalProperties).toBe(false);
      }
    }
    expect(alternatives.filter((item) => item.properties.type.const === 'rest')).toEqual([
      expect.objectContaining({
        properties: { type: { type: 'string', const: 'rest' } },
        required: ['type'],
      }),
      expect.objectContaining({ required: ['type', 'durationMs'] }),
    ]);
    expect(alternatives.filter((item) => item.properties.type.const === 'draft_mail')).toEqual([
      expect.objectContaining({ required: ['type', 'kind', 'entryIds'] }),
      expect.objectContaining({ required: ['type', 'kind', 'entryIds', 'recipientUserId'] }),
    ]);
  });

  it.each([
    { type: 'reflect' },
    { type: 'rest' },
    { type: 'rest', durationMs: 30_000 },
    { type: 'move', targetId: 'garden' },
    { type: 'move', position: { x: 1.5, z: -2 } },
    { type: 'pin_creation', creationId: 'creation-example', pinned: true },
    { type: 'draft_mail', kind: 'maker', entryIds: ['entry-example'] },
    {
      type: 'draft_mail',
      kind: 'correspondence',
      entryIds: ['entry-example'],
      recipientUserId: 'contact-example',
    },
  ])('unwraps only the transport envelope without changing the command: %j', (action) => {
    expect(parseResponsesAction(JSON.stringify({ action }))).toEqual(action);
  });

  it.each([
    'I want to rest. {"action":{"type":"rest"}}',
    '```json\n{"action":{"type":"reflect"}}\n```',
    '{"action":{"type":"reflect"}} {"action":{"type":"rest"}}',
    '{"action":',
  ])('rejects malformed or ambiguous output rather than extracting an action: %s', (text) => {
    expect(() => parseResponsesAction(text)).toThrowError(
      expect.objectContaining({ code: 'invalid_json' }),
    );
  });

  it.each([
    { type: 'rest' },
    { action: { type: 'move' } },
    { action: { type: 'move', targetId: 'bench', position: { x: 1, z: 2 } } },
    { action: { type: 'reflect', targetId: 'bench' } },
    { action: { type: 'rest', durationMs: null } },
    { action: { type: 'rest', durationMs: 0 } },
    { action: { type: 'run_shell', command: 'anything' } },
    { action: { type: 'reflect' }, explanation: 'provider-private-canary' },
  ])('retains strict canonical validation and rejects extra capabilities: %j', (value) => {
    expect(() => parseResponsesAction(JSON.stringify(value))).toThrowError(
      expect.objectContaining({ code: 'invalid_action' }),
    );
  });

  it('retains safe field diagnostics without provider values or unknown field names', () => {
    try {
      parseResponsesAction('{"action":{"type":"reflect"},"private-provider-canary":"secret"}');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDecisionError);
      expect((error as InvalidDecisionError).fields).toEqual(['other']);
      expect(String(error)).not.toContain('secret');
      expect(JSON.stringify(error)).not.toContain('private-provider-canary');
    }
  });
});
