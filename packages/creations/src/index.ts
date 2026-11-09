import type { PublicCreation } from '../../../characters/interfaces/src/index';
import {
  CreateCreationSchema,
  isPublicCreationUrl,
  type CreateCreationInput,
} from '../../../characters/interfaces/src/creations';

export const MAX_CREATIONS = 32;
export const MAX_PINNED_CREATIONS = 6;
export class CreationError extends Error {}

/** Registration records an attributed link; it does not verify authorship or remote contents. */
export function addCreation(
  items: readonly PublicCreation[],
  input: CreateCreationInput,
  author: Pick<PublicCreation, 'id' | 'characterId' | 'createdAt' | 'provenance'>,
): PublicCreation[] {
  const parsed = CreateCreationSchema.safeParse(input);
  if (!parsed.success) throw new CreationError('Creation details are invalid.');
  const url = new URL(parsed.data.url).href;
  if (items.some((item) => item.characterId === author.characterId && item.url === url))
    return [...items];
  if (items.some((item) => item.id === author.id))
    throw new CreationError('Creation identifier is already in use.');
  if (items.filter((item) => item.characterId === author.characterId).length >= MAX_CREATIONS)
    throw new CreationError('This character’s creation shelf is full.');
  return [...items, { ...parsed.data, ...author, url }];
}

/** Pinning is an explicit, replay-safe change to this character's own shelf. */
export function setCreationPinned(
  items: readonly PublicCreation[],
  characterId: string,
  creationId: string,
  pinned: boolean,
  at: number,
): PublicCreation[] {
  const item = items.find((entry) => entry.id === creationId && entry.characterId === characterId);
  if (!item) throw new CreationError('Creation not found for this character.');
  if (
    pinned &&
    item.pinnedAt === undefined &&
    items.filter((entry) => entry.characterId === characterId && entry.pinnedAt !== undefined)
      .length >= MAX_PINNED_CREATIONS
  )
    throw new CreationError('A character can pin at most six creations.');
  return items.map((entry) => {
    if (entry !== item) return entry;
    if (pinned) return { ...entry, pinnedAt: entry.pinnedAt ?? at };
    const { pinnedAt: _pinnedAt, ...unpinned } = entry;
    return unpinned;
  });
}

/** Explicit public projection, shared by controller and HTTP boundaries. */
export function publicCreations(
  items: readonly PublicCreation[],
  characterId: string,
): PublicCreation[] {
  return items
    .filter((item) => item.characterId === characterId && isPublicCreationUrl(item.url))
    .slice(-MAX_CREATIONS)
    .map(({ id, characterId, title, description, url, kind, createdAt, pinnedAt, provenance }) => ({
      id,
      characterId,
      title: title.slice(0, 120),
      description: description.slice(0, 500),
      url,
      kind,
      createdAt,
      provenance,
      ...(pinnedAt === undefined ? {} : { pinnedAt }),
    }));
}
