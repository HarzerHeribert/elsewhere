import { Agent, request } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { Readable } from 'node:stream';

/** Trust is scoped to this transport, with ordinary TLS hostname verification still enabled. */
export function pinnedHttpsFetch(certificate: string): typeof fetch {
  const blocks = certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  try {
    if (blocks?.length !== 1 || certificate.replace(blocks[0], '').trim()) throw new Error();
    const parsed = new X509Certificate(certificate);
    if (Date.parse(parsed.validTo) <= Date.now()) throw new Error();
  } catch {
    throw new Error('Private inference TLS certificate is invalid.');
  }
  const agent = new Agent({
    ca: certificate,
    keepAlive: true,
    maxSockets: 1,
    minVersion: 'TLSv1.2',
  });
  return async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (init.body !== undefined && typeof init.body !== 'string')
    )
      throw new Error('Private inference TLS request is invalid.');
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          agent,
          method: init.method ?? 'GET',
          headers: Object.fromEntries(new Headers(init.headers)),
          signal: init.signal ?? undefined,
        },
        (incoming) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) for (const part of value) headers.append(name, part);
            else if (value !== undefined) headers.set(name, value);
          }
          try {
            const status = incoming.statusCode ?? 502;
            const body = [204, 205, 304].includes(status)
              ? null
              : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
            if (body === null) incoming.resume();
            resolve(new Response(body, { status, headers }));
          } catch {
            incoming.destroy();
            reject(new Error('Private inference TLS response is invalid.'));
          }
        },
      );
      outgoing.on('error', () => reject(new Error('Private inference TLS connection failed.')));
      outgoing.end(init.body);
    });
  };
}
