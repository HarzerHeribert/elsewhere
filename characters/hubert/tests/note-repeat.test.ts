import { describe, expect, it } from 'vitest';
import { applyNote, applyPursue, createInitialHubert, noteProblem } from '../src/index';

const now = Date.UTC(2026, 10, 11, 12);
const first =
  'Matched three-turn trials at 4.03125 degrees both gave 3.8 rotations, but scraping differed: one trial scraped once and one did not.';

describe('noteProblem', () => {
  it('refuses a note that repeats an earlier one and allows one that adds something', () => {
    let state = createInitialHubert(now);
    state = applyPursue(
      state,
      { type: 'pursue', question: 'Where does the scraping begin?', why: 'The readings disagree.' },
      'pursuit-1',
      now,
    );
    expect(noteProblem(state, first)).toBeUndefined();
    state = applyNote(state, { type: 'note', text: first, surprised: false }, 'note-1', now + 1000);
    expect(noteProblem(state, first + ' I want to keep this honest.')).toMatch(/already noted/);
    expect(
      noteProblem(
        state,
        'At 4.5 degrees every one of three trials scraped once, so the change lies below it.',
      ),
    ).toBeUndefined();
  });
});
