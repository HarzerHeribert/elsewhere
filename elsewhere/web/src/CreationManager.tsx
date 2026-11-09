import { useState, type FormEvent } from 'react';
import type { PublicCreation } from '@elsewhere/character-interfaces';
import { requestJson } from './worldApi';
import { Button } from './ui/Button';
import './CreationManager.css';

/** Owner controls use the same character-scoped shelf that the resident can publish to. */
export function CreationManager({
  characterId,
  creations = [],
  onChanged,
}: {
  characterId: string;
  creations?: PublicCreation[];
  onChanged?: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const endpoint = `/api/characters/${encodeURIComponent(characterId)}/creations`;
  const owned = creations.filter((creation) => creation.characterId === characterId).slice(0, 32);

  async function mutate(url: string, body: Record<string, unknown>, success: string) {
    if (pending) return false;
    setPending(true);
    setError('');
    setStatus('');
    try {
      await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setStatus(success);
      await onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The creation could not be saved.');
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await mutate(
        endpoint,
        {
          title: String(data.get('title') ?? '').trim(),
          description: String(data.get('description') ?? '').trim(),
          url: String(data.get('url') ?? '').trim(),
          kind: String(data.get('kind') ?? 'other'),
        },
        'Link added. You can pin it below.',
      )
    )
      form.reset();
  }

  return (
    <section className="panel-section creation-manager" aria-label="Manage creations">
      <p className="eyebrow">Creations</p>
      <p>Add links to this character’s work, then choose which to pin on their profile.</p>
      <form onSubmit={(event) => void add(event)}>
        <fieldset disabled={pending}>
          <label>
            Title
            <input name="title" required maxLength={120} autoComplete="off" />
          </label>
          <label>
            Link
            <input
              name="url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://"
              autoComplete="off"
            />
          </label>
          <label>
            Description
            <textarea name="description" maxLength={500} rows={2} />
          </label>
          <label>
            Type
            <select name="kind" defaultValue="repository">
              <option value="repository">Repository</option>
              <option value="website">Website</option>
              <option value="document">Document</option>
              <option value="image">Image</option>
              <option value="other">Other</option>
            </select>
          </label>
          <Button type="submit" busy={pending}>
            Add link
          </Button>
        </fieldset>
      </form>
      {owned.map((creation) => (
        <article className="memory-row" key={creation.id}>
          <strong>{creation.title}</strong>
          <p>{creation.provenance === 'owner' ? 'Owner-added link' : 'Shared by the character'}</p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void mutate(
                `${endpoint}/${encodeURIComponent(creation.id)}/pin`,
                { pinned: creation.pinnedAt === undefined },
                creation.pinnedAt === undefined ? 'Creation pinned.' : 'Creation unpinned.',
              )
            }
          >
            {creation.pinnedAt === undefined ? 'Pin creation' : 'Unpin creation'}
          </Button>
        </article>
      ))}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
