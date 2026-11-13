import type { PublicPursuit } from '@elsewhere/character-interfaces';
import { pursuitThreads, questionText, threadHasRecord } from '../pursuitThreads';
import { QuestionKin, StatusTag, ThreadRecord, threadCounts } from './Record';

/** Per line of questions: what was tried, what came of it, what was made, what is still open. */
export function NotebookPanel({ pursuits = [] }: { pursuits?: readonly PublicPursuit[] }) {
  // A line of questions with nothing written under it has no page yet.
  const threads = pursuitThreads(pursuits).filter(threadHasRecord);
  return (
    <div className="journal">
      <p className="panel-intro">
        What I tried, what I found out, and what I still want to know, in my own words.
      </p>
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
          <ThreadRecord thread={thread} all={pursuits} readingLimit={5} noteLimit={6} days />
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
