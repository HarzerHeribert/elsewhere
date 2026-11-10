import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createGunzip, createBrotliDecompress } from 'node:zlib';
import { Readable } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { parseHTML } from 'linkedom';
import { RESEARCH_EXCERPT_LIMIT } from '../../../characters/interfaces/src/research';

export function publicWebUrl(value: string): URL {
  if (value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw Error('Unsupported web address.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw Error('Only public HTTPS pages are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host)) throw Error('Public hostname required.');
  if (
    /(?:^|\.)(localhost|local|internal|home|test|invalid)$/.test(host) ||
    (isIP(host) && !publicAddress(host))
  )
    throw Error('Public address required.');
  url.hash = '';
  return url;
}
export function publicAddress(value: string): boolean {
  try {
    return ipaddr.process(value).range() === 'unicast';
  } catch {
    return false;
  }
}
const clean = (value: string, maximum: number) =>
  value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
export function extractPage(body: string, contentType: string) {
  if (contentType.startsWith('text/plain'))
    return {
      title: 'Web page',
      excerpt: clean(body, RESEARCH_EXCERPT_LIMIT),
      truncated: body.length > RESEARCH_EXCERPT_LIMIT,
    };
  const { document } = parseHTML(body.slice(0, 262144));
  const title = clean(document.querySelector('title')?.textContent ?? 'Web page', 180);
  for (const node of document.querySelectorAll(
    'script,style,noscript,iframe,object,embed,nav,header,footer,form,svg,[hidden]',
  ))
    node.remove();
  const main = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  for (const node of main?.querySelectorAll('p,br,li,h1,h2,h3,tr') ?? []) node.append('\n');
  const text = clean(main?.textContent ?? '', 100_000);
  return {
    title,
    excerpt: text.slice(0, RESEARCH_EXCERPT_LIMIT),
    truncated: body.length > 262144 || text.length > RESEARCH_EXCERPT_LIMIT,
  };
}

/** Resolve and pin every hop. No scripts, cookies, credentials, subresources or private networks. */
export async function readPublicPage(value: string, signal: AbortSignal) {
  let url = publicWebUrl(value);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await Promise.race([
      isIP(host)
        ? Promise.resolve([{ address: host, family: isIP(host) }])
        : lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(Error('Read deadline.'));
        else
          signal.addEventListener('abort', () => reject(Error('Read deadline.')), { once: true });
      }),
    ]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw Error('Public address required.');
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          agent: false,
          signal,
          headers: {
            'user-agent': 'ElsewhereResearch/1.0',
            accept: 'text/html,text/plain;q=0.9',
            'accept-encoding': 'identity',
          },
          lookup: ((_host: string, options: { all?: boolean }, callback: Function) =>
            options.all
              ? callback(null, [address])
              : callback(
                  null,
                  address.address,
                  address.family,
                )) as import('node:net').LookupFunction,
        },
        resolve,
      );
      req.on('error', () => reject(Error('Web page unavailable.')));
      req.end();
    });
    response.on('error', () => undefined);
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || hop === 3) throw Error('Redirect limit.');
      url = publicWebUrl(new URL(location, url).href);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw Error('Web page unavailable.');
    }
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('text/html') && !type.startsWith('text/plain')) {
      response.destroy();
      throw Error('Unsupported page format.');
    }
    const encoding = response.headers['content-encoding'];
    let stream: Readable = response;
    if (encoding && encoding !== 'identity') {
      if (encoding === 'gzip') stream = response.pipe(createGunzip());
      else if (encoding === 'br') stream = response.pipe(createBrotliDecompress());
      else {
        response.destroy();
        throw Error('Unsupported page encoding.');
      }
    }
    const abortBody = () => {
      stream.destroy(Error('Read deadline.'));
      response.destroy();
    };
    const sourceError = (error: Error) => stream.destroy(error);
    if (stream !== response) response.on('error', sourceError);
    signal.addEventListener('abort', abortBody, { once: true });
    const chunks: Buffer[] = [];
    let bytes = 0,
      cutoff = false;
    try {
      for await (const raw of stream) {
        const chunk = Buffer.from(raw);
        const remaining = 524288 - bytes;
        chunks.push(chunk.subarray(0, remaining));
        bytes += Math.min(remaining, chunk.length);
        if (bytes >= 524288) {
          cutoff = true;
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', abortBody);
      if (stream !== response) response.off('error', sourceError);
      stream.destroy();
      response.destroy();
    }
    const extracted = extractPage(Buffer.concat(chunks).toString('utf8'), type);
    if (extracted.excerpt.length < 40) throw Error('No readable page text.');
    return { ...extracted, truncated: extracted.truncated || cutoff, url: url.href };
  }
  throw Error('Redirect limit.');
}
