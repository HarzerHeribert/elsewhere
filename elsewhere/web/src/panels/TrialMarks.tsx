import { useState } from 'react';
import { parseReading, type Filed } from '../pursuitThreads';
import { formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

/** One selectable mark per recorded trial, oldest to newest. */
export function TrialMarks({ readings }: { readings: readonly Filed<'tried'>[] }) {
  const toWall = useWallTime();
  const [chosen, select] = useState<string>();
  const trials = [...readings].reverse();
  const current = trials.find((trial) => trial.id === chosen) ?? trials.at(-1);
  if (!current) return null;
  return (
    <section className="trial-figure" aria-label="Trials in recording order">
      <h4>Trials</h4>
      <div className="trial-marks">
        {trials.map((trial, i) => (
          <button
            key={trial.id}
            aria-label={'Trial ' + (i + 1) + ' · ' + formatTime(toWall(trial.at))}
            aria-pressed={trial.id === current.id}
            onClick={() => select(trial.id)}
          >
            <span />
          </button>
        ))}
      </div>
      <p aria-live="polite">{parseReading(current.text).result}</p>
    </section>
  );
}
