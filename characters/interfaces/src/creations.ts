import { z } from 'zod';

/** A public portfolio link, not permission to fetch or execute its target. */
export function isPublicCreationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      host.includes('.') &&
      !host.endsWith('.') &&
      !/^\d+(?:\.\d+){3}$/.test(host) &&
      !host.startsWith('[') &&
      !['localhost', 'local', 'internal', 'lan', 'home', 'test'].some(
        (suffix) => host === suffix || host.endsWith('.' + suffix),
      )
    );
  } catch {
    return false;
  }
}
export const CreateCreationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    url: z.string().trim().max(2048).refine(isPublicCreationUrl),
    kind: z.enum(['repository', 'website', 'document', 'image', 'other']),
  })
  .strict();
export type CreateCreationInput = z.infer<typeof CreateCreationSchema>;
export const PinCreationSchema = z.object({ pinned: z.boolean() }).strict();
