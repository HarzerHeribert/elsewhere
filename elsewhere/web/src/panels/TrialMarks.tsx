import { useState } from 'react';
import { parseReading, type Filed } from '../pursuitThreads';
import { formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

/** One selectable mark per recorded trial, oldest to newest. */
export function TrialMarks({ readings }: { readings: readonly Filed<'tried'>[] }) {
  const toWall = useWallTime();
  const [chosen, select] = useState<string>();
  const trials = [...readings].reverse();
  const index = Math.max(
    0,
    chosen ? trials.findIndex((trial) => trial.id === chosen) : trials.length - 1,
  );
  const current = trials[index];
  const batch = 12;
  const start = Math.floor(index / batch) * batch;
  if (!current) return null;
  return (
    <section className="trial-figure" aria-label="Trials in recording order">
      <div className="trial-heading">
        <h4>Trials</h4>
        <div className="trial-pagination">
          <button
            aria-label="Earlier trials"
            disabled={start === 0}
            onClick={() => select(trials[start - 1]!.id)}
          >
            ‹
          </button>
          <span>
            {start + 1}–{Math.min(start + batch, trials.length)} of {trials.length}
          </span>
          <button
            aria-label="Later trials"
            disabled={start + batch >= trials.length}
            onClick={() => select(trials[start + batch]!.id)}
          >
            ›
          </button>
        </div>
      </div>
      <div className="trial-marks">
        {trials.slice(start, start + batch).map((trial, i) => (
          <button
            key={trial.id}
            aria-label={'Trial ' + (start + i + 1) + ' · ' + formatTime(toWall(trial.at))}
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
