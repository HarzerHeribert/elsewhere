import { useState } from 'react';
import type { ProviderIssue } from '@elsewhere/character-interfaces';
import { Button } from './ui/Button';
import './CharacterProviderNotices.css';

const characterName = (id: string) => (id === 'hubert' ? 'Hubert' : id);
const workloadName = (workload: ProviderIssue['workload']) =>
  workload === 'notebook' ? 'Notebook' : workload === 'reflection' ? 'Reflection' : 'Decisions';

/** Explain the bounded host diagnostic, never a provider body or private reasoning. */
function feedback(code: ProviderIssue['code']) {
  switch (code) {
    case 'invalid_json':
      return 'The model answered, but its reply could not be read as a JSON action.';
    case 'invalid_action':
      return 'The model answered, but its reply did not match the allowed action format.';
    case 'unavailable_action':
      return 'The model chose an action or target that was not available at that moment.';
    case 'request_failed':
    case 'provider_unavailable':
    case 'network_unavailable':
    case 'network_or_stream_unavailable':
    case 'unavailable':
    case 'request_timeout':
    case 'deadline_exceeded':
    case 'busy':
      return 'The provider did not return a reply for this request. This is a service or connection problem, not a problem with the reply format.';
    case 'daily_limit':
    case 'daily_token_limit':
      return 'The inference service has reached its daily allowance and accepts requests again when it resets. This is not a problem with the reply format.';
    case 'usage_unknown':
      return 'Too many requests today ended without a usage report, so the inference service paused as a spending precaution until its daily reset.';
    case 'unauthorized':
    case 'not_authorized':
      return 'The inference service refused this world’s access. This does not pass by itself: repair the connection or sign-in, then retry.';
    case 'response_incomplete':
    case 'stream_interrupted':
      return 'The model response ended before it was complete.';
    default:
      return undefined;
  }
}

function Diagnostic({ issue }: { issue: ProviderIssue }) {
  if (!issue.code) return null;
  return (
    <>
      {feedback(issue.code) && <p>{feedback(issue.code)}</p>}
      <details className="character-provider-notices__diagnostic">
        <summary>Technical details</summary>
        <p>
          Code: <code>{issue.code}</code>
          {issue.fields?.length ? ' · Fields: ' + issue.fields.join(', ') : ''}
        </p>
      </details>
    </>
  );
}

function issueSignature(issues: readonly ProviderIssue[], characterId: string) {
  return JSON.stringify(
    issues
      .filter((issue) => issue.characterId === characterId)
      .map(({ id, lastAt, kind, code, retrying }) => ({ id, lastAt, kind, code, retrying })),
  );
}

export function CharacterProviderNotices({
  issues,
  pending,
  onRetry,
  canRetry = true,
}: {
  issues: readonly ProviderIssue[];
  pending: boolean;
  canRetry?: boolean;
  onRetry: (characterId: string) => Promise<boolean>;
}) {
  const [requested, setRequested] = useState<Record<string, string>>({});
  if (!issues.length) return null;
  const active = issues
    .filter((issue) => issue.resolvedAt === undefined)
    .sort((a, b) => b.lastAt - a.lastAt);
  const recovered = issues
    .filter((issue) => issue.resolvedAt !== undefined)
    .sort((a, b) => b.resolvedAt! - a.resolvedAt!);
  const retryCharacters = [
    // A paced correction needs no retry; provider trouble that passes by itself may be retried
    // at once by an owner who has just fixed the connection.
    ...new Set(
      active
        .filter((issue) => !issue.retrying || issue.kind !== 'invalid')
        .map((i) => i.characterId),
    ),
  ];
  const retryScheduled = (characterId: string) =>
    requested[characterId] === issueSignature(active, characterId);

  async function retry(characterId: string) {
    const signature = issueSignature(active, characterId);
    if (await onRetry(characterId))
      setRequested((value) => ({ ...value, [characterId]: signature }));
  }

  return (
    <section className="character-provider-notices" aria-label="Character provider notices">
      <h3>Your characters</h3>
      {!active.length && <p>No active character issues.</p>}
      {active.map((issue) => (
        <article key={issue.id} className="memory-glimpse">
          <strong>
            {characterName(issue.characterId)} ·{' '}
            {retryScheduled(issue.characterId)
              ? 'Retry scheduled'
              : issue.retrying
                ? issue.kind === 'invalid'
                  ? 'Reconsidering'
                  : 'Trying again automatically'
                : 'Needs attention'}
          </strong>
          <p>
            {retryScheduled(issue.characterId)
              ? 'A retry has been requested for the next turn.'
              : issue.message}
          </p>
          <Diagnostic issue={issue} />
          <small>
            {workloadName(issue.workload)} · Last attempt{' '}
            <time dateTime={new Date(issue.lastAt).toISOString()}>
              {new Date(issue.lastAt).toLocaleString()}
            </time>
          </small>
        </article>
      ))}
      {!canRetry && retryCharacters.length > 0 && (
        <p>Verify a passkey to retry your character’s waiting work.</p>
      )}
      {canRetry &&
        retryCharacters.map((characterId) => (
          <div className="character-provider-notices__retry" key={characterId}>
            {retryScheduled(characterId) ? (
              <p role="status">
                Retry requested for {characterName(characterId)}. Waiting for the next turn.
              </p>
            ) : (
              <>
                <Button variant="secondary" busy={pending} onClick={() => void retry(characterId)}>
                  Retry {characterName(characterId)}
                </Button>
                <small>Retrying uses your connected model allowance.</small>
              </>
            )}
          </div>
        ))}
      {recovered.length > 0 && (
        <details className="character-provider-notices__history">
          <summary>Recovered issues · {recovered.length}</summary>
          {recovered.map((issue) => (
            <article key={issue.id} className="memory-glimpse">
              <strong>{characterName(issue.characterId)} · Recovered</strong>
              <p>
                {workloadName(issue.workload)} recovered{' '}
                <time dateTime={new Date(issue.resolvedAt!).toISOString()}>
                  {new Date(issue.resolvedAt!).toLocaleString()}
                </time>
                .
              </p>
              <Diagnostic issue={issue} />
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
