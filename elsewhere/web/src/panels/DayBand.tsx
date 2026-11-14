import { useState } from 'react';
import type { PublicTrailEntry } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';
import { trailLabel } from '../trailLabels';
import { useWallTime } from '../worldClock';

/** Consecutive observations of the same action and place, within the selected day. */
export function DayBand({ entries }: { entries: PublicTrailEntry[] }) {
  const toWall = useWallTime();
  const [selection, select] = useState<string>();
  const stretches: { first: PublicTrailEntry; last: PublicTrailEntry }[] = [];
  for (const step of [...entries].sort((a, b) => a.at - b.at)) {
    const previous = stretches.at(-1);
    if (
      previous &&
      previous.last.kind === step.kind &&
      previous.last.placeId === step.placeId &&
      previous.last.pursuitId === step.pursuitId
    )
      previous.last = step;
    else stretches.push({ first: step, last: step });
  }
  if (!stretches.length) return null;
  const active = stretches.find((s) => s.first.id === selection) ?? stretches[0]!;
  return (
    <section className="day-band" aria-label="Day observations">
      <div className="day-band-strip" role="group" aria-label="Recorded stretches">
        {stretches.map((s) => (
          <button
            key={s.first.id}
            aria-pressed={s === active}
            aria-label={formatTime(toWall(s.first.at)) + ' · ' + trailLabel(s.first)}
            onClick={() => select(s.first.id)}
          >
            {formatTime(toWall(s.first.at))}
          </button>
        ))}
      </div>
      <p aria-live="polite">
        <strong>
          {formatTime(toWall(active.first.at))}
          {active.last.at > active.first.at && ' – ' + formatTime(toWall(active.last.at))}
        </strong>{' '}
        {active.last.text || active.last.why || trailLabel(active.last)}
      </p>
    </section>
  );
}
