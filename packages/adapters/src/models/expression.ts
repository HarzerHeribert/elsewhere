import { z } from 'zod';
import { canonicalJson } from '../../../models/src/data';
import {
  STUDIO_PATH,
  STUDIO_PATH_LIMIT,
  STUDIO_TEXT_LIMIT,
} from '../../../../characters/interfaces/src/studio';

/**
 * Authoring one file of the character's own public site. Everything in it is the character's
 * own record: its notes and readings, never visitor messages or private memories.
 */
const PublicWorkInputSchema = z
  .object({
    form: z.literal('work'),
    path: z.string().max(STUDIO_PATH_LIMIT).regex(STUDIO_PATH),
    title: z.string().trim().min(1).max(80),
    about: z.string().trim().min(1).max(600),
    /** The current text of the file when it is being revised. */
    existing: z.string().max(STUDIO_TEXT_LIMIT).optional(),
    siteUrl: z.string().max(2048),
    material: z
      .object({
        question: z.string().max(240).optional(),
        why: z.string().max(240).optional(),
        notes: z.array(z.string().max(600)).max(12),
        readings: z.array(z.string().max(240)).max(30),
        openQuestions: z.array(z.string().max(240)).max(8),
      })
      .strict(),
    shelf: z
      .array(
        z.object({ path: z.string().max(STUDIO_PATH_LIMIT), title: z.string().max(120) }).strict(),
      )
      .max(32),
  })
  .strict();
export const PublicExpressionInputSchema = z.discriminatedUnion('form', [PublicWorkInputSchema]);
export type PublicExpressionInput = z.infer<typeof PublicExpressionInputSchema>;
export interface ExpressionProvider {
  /** Refresh local connection state only; provider and host budgets remain authoritative. */
  resetAvailability?(): void;
  readonly id: string;
  readonly localOnly?: boolean;
  isAvailable?(): boolean;
  express(input: PublicExpressionInput, onDelta?: (text: string) => void): Promise<string>;
}
export function expressionMessages(identity: string, input: PublicExpressionInput) {
  const parsed = PublicExpressionInputSchema.parse(input);
  const { form: _form, ...data } = parsed;
  return [
    {
      role: 'system',
      content: `${identity}\nYou are writing one file for your own public site; it is published exactly as you return it and nobody reviews it. Return only the complete content of the file at the given path, in the format its extension implies, with no explanation and no code fence around it. Form, tone and content are yours. Use only what you actually found: the notes and readings in material are your record; do not invent readings, sources or results, and say so where something is unknown. When existing is present you are revising that file: return the whole new file. Never include the content of outside messages.`,
    },
    { role: 'user', content: canonicalJson(data) },
  ];
}
/**
 * The complete text of one file. A single surrounding markdown fence, which models add out of
 * habit, is removed; an empty or oversized file is never published.
 */
export function validatePublicWork(input: unknown): string {
  let value = z
    .string()
    .max(STUDIO_TEXT_LIMIT * 2)
    .parse(input)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
  const fenced = /^```[\w+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(value);
  if (fenced) value = fenced[1].trim();
  if (!value || value.length > STUDIO_TEXT_LIMIT) throw Error('Expected the text of one file.');
  return value;
}
export function validatePublicExpression(input: unknown, _form: 'work' = 'work'): string {
  return validatePublicWork(input);
}
