import type { PublicResearchEpisode } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function ResearchDetails({ episodes }: { episodes: PublicResearchEpisode[] }) {
  return (
    <section className="panel-section" aria-label="Research history">
      <p className="eyebrow">Research</p>
      {[...episodes].reverse().map((episode) => (
        <details className="memory-row" key={episode.id}>
          <summary>
            {episode.topic} · {episode.status.replace(/-/g, ' ')}
          </summary>
          <time>{formatTime(episode.at)}</time>
          <p>
            <strong>Context:</strong> {episode.context}
          </p>
          <p>
            <strong>Search query:</strong> {episode.query}
          </p>
          {episode.outcome && <p>{episode.outcome}</p>}
          {episode.sources.map((source) => (
            <article key={source.id}>
              <p>
                {safeLink(source.url) ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title || source.url} ↗
                  </a>
                ) : (
                  source.title
                )}
                {' · '}
                {source.status === 'returned'
                  ? 'Search result · not read'
                  : source.status === 'read'
                    ? 'Read'
                    : 'Reading deferred'}
              </p>
              {source.snippet && <p>{source.snippet}</p>}
              {source.excerpt && (
                <details>
                  <summary>Source excerpt</summary>
                  <blockquote>{source.excerpt}</blockquote>
                </details>
              )}
            </article>
          ))}
          {episode.nextStep && (
            <p>
              <strong>Follow-up:</strong> {episode.nextStep}
            </p>
          )}
        </details>
      ))}
    </section>
  );
}
