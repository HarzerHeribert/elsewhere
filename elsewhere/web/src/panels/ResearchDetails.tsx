import type { PublicResearchEpisode } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';
import { Icon } from '../Icon';
import { researchInProgress } from '../activityStory';

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
function host(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
const statusLabels: Record<PublicResearchEpisode['status'], string> = {
  searching: 'Searching now',
  'sources-found': 'Sources found',
  reading: 'Reading now',
  read: 'Finished reading',
  deferred: 'Set aside',
};
const sourceLabels = { read: 'Read', returned: 'Found, not opened', deferred: 'Set aside' };
export const researchStatus = (episode: PublicResearchEpisode) => statusLabels[episode.status];

/** The four stages every investigation passes through, with the current one marked. */
export function ResearchSteps({ episode }: { episode: PublicResearchEpisode }) {
  const read = episode.sources.filter((source) => source.status === 'read').length;
  const total = episode.sources.length;
  const steps = [
    { label: 'Asked', state: 'done' },
    { label: 'Searched', state: episode.status === 'searching' ? 'current' : 'done' },
    {
      label: total ? 'Reading · ' + read + ' of ' + total : 'Reading',
      state:
        episode.status === 'reading'
          ? 'current'
          : episode.status === 'read' || read > 0
            ? 'done'
            : 'pending',
    },
    {
      label: 'Conclusion',
      state: episode.status === 'read' && episode.outcome ? 'done' : 'pending',
    },
  ];
  return (
    <ol className="research-steps" aria-label="Research progress">
      {steps.map((step) => (
        <li
          key={step.label}
          className={step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {step.label}
        </li>
      ))}
    </ol>
  );
}

export function ResearchList({
  episodes,
  onOpen,
}: {
  episodes: readonly PublicResearchEpisode[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="research-list" aria-label="Research history">
      <p className="panel-intro">Questions I followed beyond Elsewhere, and what I found.</p>
      {[...episodes].reverse().map((episode) => (
        <button key={episode.id} className="research-card" onClick={() => onOpen(episode.id)}>
          <span className={'research-flag' + (researchInProgress(episode) ? ' live' : '')}>
            {researchStatus(episode)}
          </span>
          <strong>{episode.topic}</strong>
          <small>
            {formatTime(episode.at)} ·{' '}
            {episode.sources.length === 1 ? '1 source' : episode.sources.length + ' sources'}
          </small>
          <Icon name="chevron-right" />
        </button>
      ))}
      {!episodes.length && <p className="empty-state">I haven’t looked anything up yet.</p>}
    </section>
  );
}

export function ResearchStory({
  episode,
  backLabel,
  onBack,
}: {
  episode: PublicResearchEpisode;
  backLabel: string;
  onBack: () => void;
}) {
  const live = researchInProgress(episode);
  return (
    <article className="research-story" aria-label={'Research: ' + episode.topic}>
      <div className="story-top">
        <button className="back-link" onClick={onBack}>
          <Icon name="chevron-left" />
          {backLabel}
        </button>
        <span className={'research-flag' + (live ? ' live' : '')}>{researchStatus(episode)}</span>
      </div>
      <p className="eyebrow">{live ? 'I’m looking into' : 'I looked into'}</p>
      <h3>{episode.topic}</h3>
      <ol className="story-steps">
        <li className="done">
          <h4>Why I wondered</h4>
          <p>{episode.context}</p>
        </li>
        <li className={episode.status === 'searching' ? 'current' : 'done'}>
          <h4>What I searched for</h4>
          <code className="research-query">{episode.query}</code>
        </li>
        <li
          className={
            episode.status === 'reading' ? 'current' : episode.sources.length ? 'done' : 'pending'
          }
        >
          <h4>{live ? 'What I’m reading' : 'What I found'}</h4>
          {episode.sources.length ? (
            <div className="source-list">
              {episode.sources.map((source) => (
                <article
                  key={source.id}
                  className={
                    'source-row ' +
                    (episode.readingSourceId === source.id ? 'reading' : source.status)
                  }
                >
                  <div>
                    <p className="source-title">
                      {safeLink(source.url) ? (
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.title || source.url} ↗
                        </a>
                      ) : (
                        source.title
                      )}
                    </p>
                    <small>{host(source.url)}</small>
                  </div>
                  <span className="source-status">
                    {episode.readingSourceId === source.id
                      ? 'Reading now'
                      : sourceLabels[source.status]}
                  </span>
                  {source.snippet && <p className="source-snippet">{source.snippet}</p>}
                  {source.excerpt && (
                    <details>
                      <summary>Source excerpt</summary>
                      <blockquote>{source.excerpt}</blockquote>
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p>Nothing has come back yet.</p>
          )}
        </li>
        <li className={episode.outcome && !live ? 'done' : 'pending'}>
          <h4>What I take away</h4>
          <p>{episode.outcome ?? 'I’ll write it here when I finish.'}</p>
          {episode.nextStep && (
            <p>
              <strong>Next:</strong> {episode.nextStep}
            </p>
          )}
        </li>
      </ol>
    </article>
  );
}
