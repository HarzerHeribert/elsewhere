import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
export const ResearchBindingSchema = z
  .object({ worldId: id, ownerUserId: id, characterId: id, connectionId: id })
  .strict();
export type ResearchBinding = z.infer<typeof ResearchBindingSchema>;
export const ResearchSourceSchema = z
  .object({
    id,
    url: z.string().url().max(2048),
    title: z.string().max(180),
    snippet: z.string().max(600),
  })
  .strict();
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;
export const ResearchSearchSchema = z
  .object({ requestId: id, query: z.string().trim().min(3).max(240) })
  .strict();
export const ResearchReadSchema = z.object({ requestId: id, sourceId: id }).strict();
export const ResearchSearchResultSchema = z
  .object({
    kind: z.literal('search'),
    receiptId: id,
    provider: z.enum(['tavily', 'searxng']),
    query: z.string().max(240),
    fetchedAt: z.number().int().nonnegative(),
    cached: z.boolean(),
    sources: z.array(ResearchSourceSchema).max(5),
  })
  .strict();
/** Longest page excerpt a read result may carry. */
export const RESEARCH_EXCERPT_LIMIT = 12000;
export const ResearchReadResultSchema = z
  .object({
    kind: z.literal('read'),
    receiptId: id,
    sourceId: id,
    url: z.string().url().max(2048),
    title: z.string().max(180),
    fetchedAt: z.number().int().nonnegative(),
    cached: z.boolean(),
    excerpt: z.string().max(RESEARCH_EXCERPT_LIMIT),
    truncated: z.boolean(),
  })
  .strict();
export type ResearchSearchResult = z.infer<typeof ResearchSearchResultSchema>;
export type ResearchReadResult = z.infer<typeof ResearchReadResultSchema>;
export type ResearchResult = ResearchSearchResult | ResearchReadResult;
export interface CharacterResearchPort {
  search(input: z.infer<typeof ResearchSearchSchema>): Promise<ResearchSearchResult>;
  read(input: z.infer<typeof ResearchReadSchema>): Promise<ResearchReadResult>;
}
export function encodeResearchBinding(binding: ResearchBinding): string {
  return Buffer.from(JSON.stringify(ResearchBindingSchema.parse(binding))).toString('base64url');
}
