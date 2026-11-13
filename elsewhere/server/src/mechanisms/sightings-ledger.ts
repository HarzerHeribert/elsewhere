import { act, type Mechanism } from './common.js';
import { monthName, takenNote } from './outside.js';
import type { SpeciesGroup } from '../feeds/types.js';

const BLANK = 'Nothing has come in yet; the ledger page is blank.';
const heading = (group: SpeciesGroup) => `${group[0].toUpperCase()}${group.slice(1)}`;

/** What observers reported within about 30 km in this calendar month over the years. */
export const sightingsLedger: Mechanism = {
  controls: (['birds', 'insects', 'mammals', 'plants'] as const).map((group) =>
    act(group, `read the ledger page for ${group}`),
  ),
  run: ({ control, feeds, now }) => {
    const species = feeds?.species;
    if (!species) return { problem: BLANK };
    const page = species.groups[control as SpeciesGroup];
    if (!page) return { problem: BLANK };
    const month = monthName(species.fetchedAt);
    const note = takenNote(species.fetchedAt, now);
    if (!page.species.length)
      return {
        reading: `${heading(control as SpeciesGroup)}: ${page.total} records within about 30 km in ${month} over the years.${note}`,
      };
    const list = page.species.map((item) => `${item.name} ${item.count}`).join(', ');
    return {
      reading: `${heading(control as SpeciesGroup)}: ${page.total} records within about 30 km in ${month} over the years. Most recorded: ${list}.${note}`,
    };
  },
};
