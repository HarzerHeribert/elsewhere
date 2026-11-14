import type { PublicPursuit } from '@elsewhere/character-interfaces';
import { pursuitThreads, questionText, threadHasRecord } from '../pursuitThreads';
import { TrialMarks } from './TrialMarks';
import { NoteList, QuestionKin, StatusTag, ThreadRecord, threadCounts } from './Record';

/** Per line of questions: what was tried, what came of it, what was made, what is still open. */
export function NotebookPanel({ pursuits = [] }: { pursuits?: readonly PublicPursuit[] }) {
  // A line of questions with nothing written under it has no page yet.
  const threads = pursuitThreads(pursuits).filter(threadHasRecord);
  const notes = threads.flatMap((thread) => thread.notes).sort((a, b) => b.at - a.at);
  return (
    <div className="journal">
      {notes[0] && <NoteList notes={notes} all={pursuits} limit={5} days />}
      {threads.length > 0 && <h3 className="inquiry-heading">Lines of inquiry</h3>}
      {threads.map((thread) => (
        <section
          className="record notebook-thread"
          key={thread.id}
          aria-label={thread.lead.question}
        >
          <header>
            <StatusTag status={thread.status} />
            <h3 className="question-title">{questionText(thread.lead, pursuits)}</h3>
            {thread.lead.why && <p className="question-why">{thread.lead.why}</p>}
            <small className="question-counts">{threadCounts(thread)}</small>
          </header>
          <QuestionKin thread={thread} all={pursuits} />
          <TrialMarks readings={thread.readings} />
          <details className="inquiry-record">
            <summary>Read the full record</summary>
            <ThreadRecord thread={thread} all={pursuits} readingLimit={5} noteLimit={6} />
          </details>
        </section>
      ))}
      {!threads.length && (
        <p className="empty-state">
          My notebook is quiet for now. Notes appear when I have something to share.
        </p>
      )}
    </div>
  );
}
