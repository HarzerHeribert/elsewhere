import type { PublicTrailEntry } from '@elsewhere/character-interfaces';

const labels: Record<string, string> = {
  pursue: 'I took up a question',
  set_aside: 'I set a question aside',
  search: 'I searched the web',
  read: 'I read a page',
  note: 'I wrote a note',
  move: 'I went somewhere',
  look: 'I looked around',
  inspect: 'I looked closely',
  rest: 'I rested',
  interact: 'I tried something',
  work: 'I worked on something',
  reflect: 'I thought it over',
  pin_creation: 'I tidied my creations',
  draft_mail: 'I drafted a letter',
};
/** A plain label for a step of the trail. */
export const trailLabel = (entry: Pick<PublicTrailEntry, 'kind'>) =>
  labels[entry.kind] ?? 'I did something';
