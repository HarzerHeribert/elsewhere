import {
  ResearchReadResultSchema,
  ResearchSearchResultSchema,
  encodeResearchBinding,
  type CharacterResearchPort,
  type ResearchBinding,
} from '../../../characters/interfaces/src/research';
import { pinnedHttpsFetch } from '../../inference/src/pinned-https';
import { boundedJson } from './json';

export class ResearchClient implements CharacterResearchPort {
  private readonly fetcher: typeof fetch;
  private readonly url: URL;
  private readonly binding: string;
  constructor(
    private readonly options: {
      url: string;
      token: string;
      binding: ResearchBinding;
      caCertificate?: string;
      allowPrivateHttp?: boolean;
      fetcher?: typeof fetch;
    },
  ) {
    this.url = new URL(options.url);
    if (
      this.url.username ||
      this.url.password ||
      this.url.search ||
      this.url.hash ||
      this.url.pathname !== '/' ||
      !['http:', 'https:'].includes(this.url.protocol) ||
      (this.url.protocol === 'http:' && !options.allowPrivateHttp) ||
      !/^[a-zA-Z0-9_-]{32,512}$/.test(options.token)
    )
      throw Error('Invalid research connection.');
    this.binding = encodeResearchBinding(options.binding);
    this.fetcher =
      options.fetcher ?? (options.caCertificate ? pinnedHttpsFetch(options.caCertificate) : fetch);
  }
  private async call(kind: 'search' | 'read', input: unknown) {
    try {
      const r = await this.fetcher(new URL('/v1/research/' + kind, this.url), {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + this.options.token,
          'x-elsewhere-research-binding': this.binding,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw Error('Research unavailable.');
      }
      const value = await boundedJson(r);
      return kind === 'search'
        ? ResearchSearchResultSchema.parse(value)
        : ResearchReadResultSchema.parse(value);
    } catch {
      throw Error('Research unavailable; retry later.');
    }
  }
  async search(input: Parameters<CharacterResearchPort['search']>[0]) {
    return ResearchSearchResultSchema.parse(await this.call('search', input));
  }
  async read(input: Parameters<CharacterResearchPort['read']>[0]) {
    return ResearchReadResultSchema.parse(await this.call('read', input));
  }
}
