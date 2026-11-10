import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProviderIssue } from '@elsewhere/character-interfaces';
import { CharacterProviderNotices } from './CharacterProviderNotices';

const issue = (id: string, patch: Partial<ProviderIssue> = {}): ProviderIssue => ({
  id,
  characterId: 'hubert',
  kind: 'invalid',
  code: 'invalid_json',
  workload: 'decision',
  since: 1000,
  lastAt: 2000,
  message: 'New decisions are waiting for your attention.',
  ...patch,
});
const render = (issues: ProviderIssue[]) =>
  renderToStaticMarkup(
    createElement(CharacterProviderNotices, {
      issues,
      pending: false,
      onRetry: async () => true,
    }),
  );

describe('private character provider notices', () => {
  it('prioritizes the active failure and collapses resolved history without losing it', () => {
    const issues = [
      issue('old', { resolvedAt: 3000, message: 'OLD-FAILURE-CANARY' }),
      issue('current', { message: 'CURRENT-FAILURE-CANARY', lastAt: 5000 }),
      issue('recent', { resolvedAt: 4000, message: 'RECENT-FAILURE-CANARY' }),
    ];
    const before = structuredClone(issues);
    const html = render(issues);
    const history = html.indexOf('character-provider-notices__history');
    expect(html.indexOf('CURRENT-FAILURE-CANARY')).toBeLessThan(history);
    expect(html).toContain('<summary>Recovered issues · 2</summary>');
    expect(html.slice(history)).not.toContain('<details open');
    expect(html.slice(history)).toContain('Hubert · Recovered');
    expect(html).not.toContain('OLD-FAILURE-CANARY');
    expect(html).not.toContain('RECENT-FAILURE-CANARY');
    expect(issues).toEqual(before);
  });

  it('describes model format failures separately from connection outages and retains bounded details', () => {
    const html = render([issue('invalid', { fields: ['type'] })]);
    expect(html).toContain('The model answered, but its reply could not be read as a JSON action.');
    expect(html).toContain('<summary>Technical details</summary>');
    expect(html).toContain('<code>invalid_json</code>');
    expect(html).toContain('Fields: type');
    expect(html).toContain('Last attempt');
    expect(html).toContain('1970-01-01T00:00:02.000Z');
    expect(html).not.toContain('Retry provider');
  });

  it('offers one retry per character even when several workloads failed, without offering retries for recovered or paced corrections', () => {
    const html = render([
      issue('decision'),
      issue('notebook', { workload: 'notebook', kind: 'failed' }),
      issue('reflection', { workload: 'reflection', retrying: true }),
      issue('recovered', { resolvedAt: 4000 }),
    ]);
    expect(html.match(/Retry Hubert/g)).toHaveLength(1);
    expect(html).toContain('Reconsidering');
    expect(render([issue('paced', { retrying: true })])).not.toContain('<button');
    const recovered = render([issue('recovered', { resolvedAt: 4000 })]);
    expect(recovered).toContain('No active character issues.');
    expect(recovered).not.toContain('<button');
  });

  it('presents provider trouble that passes by itself as automatic, not as a reply-format problem, and still lets the owner retry at once', () => {
    const html = render([
      issue('waiting', {
        kind: 'failed',
        code: 'request_failed',
        retrying: true,
        message: 'A request to the model provider failed.',
      }),
    ]);
    expect(html).toContain('Trying again automatically');
    expect(html).not.toContain('Needs attention');
    expect(html).not.toContain('Reconsidering');
    expect(html).toContain('not a problem with the reply format');
    expect(html.match(/Retry Hubert/g)).toHaveLength(1);
  });

  it('explains a daily limit as passing by itself and refused access as needing the owner', () => {
    const limited = render([
      issue('limited', { kind: 'unavailable', code: 'daily_limit', retrying: true }),
    ]);
    expect(limited).toContain('Trying again automatically');
    expect(limited).toContain('accepts requests again when it resets');
    const refused = render([issue('refused', { kind: 'unavailable', code: 'not_authorized' })]);
    expect(refused).toContain('Needs attention');
    expect(refused).not.toContain('Trying again automatically');
    expect(refused).toContain('This does not pass by itself');
    expect(refused.match(/Retry Hubert/g)).toHaveLength(1);
  });

  it('renders no notices for an empty private issue list and escapes diagnostic strings', () => {
    expect(render([])).toBe('');
    const html = render([issue('escaped', { code: '<script>bad</script>', fields: ['<img>'] })]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img>');
  });
});
