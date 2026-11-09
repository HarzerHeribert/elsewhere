import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { publicWebUrl, publicAddress, extractPage, readPublicPage } from './reader';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
function reply(status: number, headers: Record<string, string>, body: string) {
  mocks.request.mockImplementationOnce((_url: unknown, _options: unknown, callback: Function) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () =>
      queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), { statusCode: status, headers });
        callback(response);
        response.end(body);
      });
    return req;
  });
}
describe('controlled public web reader', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => expect(publicAddress(address)).toBe(false));
  it.each([
    'http://example.com',
    'https://127.0.0.1/',
    'https://user:pass@example.com',
    'https://example.com:9443/',
    'https://localhost/',
  ])('rejects unsupported URL %s', (url) => expect(() => publicWebUrl(url)).toThrow());
  it('parses text without executing or including scripts, navigation and forms', () => {
    const result = extractPage(
      '<html><head><title>Birds</title></head><body><nav>NAV-CANARY</nav><article><p>A sparrow is described here in external source text.</p><script>SECRET-CANARY</script><form>FORM-CANARY</form></article></body></html>',
      'text/html',
    );
    expect(result.title).toBe('Birds');
    expect(result.excerpt).toContain('sparrow');
    expect(result.excerpt).not.toMatch(/CANARY/);
  });
  it('pins the validated DNS address and returns a bounded excerpt', async () => {
    reply(
      200,
      { 'content-type': 'text/html' },
      '<html><head><title>Birds</title></head><body><article>' +
        'Bird observations. '.repeat(300) +
        '</article></body></html>',
    );
    const result = await readPublicPage('https://example.com/birds', AbortSignal.timeout(1000));
    expect(result.excerpt.length).toBe(4000);
    expect(result.truncated).toBe(true);
    const options = mocks.request.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(options.agent).toBe(false);
    expect(options.headers).not.toHaveProperty('cookie');
  });
  it('blocks mixed private DNS answers and redirects into private networks before connecting', async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(readPublicPage('https://example.com', AbortSignal.timeout(1000))).rejects.toThrow(
      'Public address',
    );
    expect(mocks.request).not.toHaveBeenCalled();
    reply(302, { location: 'https://169.254.169.254/metadata' }, '');
    await expect(readPublicPage('https://example.com', AbortSignal.timeout(1000))).rejects.toThrow(
      'Public address',
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('rejects non-page content and truncates oversized pages', async () => {
    reply(200, { 'content-type': 'application/octet-stream' }, 'binary');
    await expect(readPublicPage('https://example.com', AbortSignal.timeout(1000))).rejects.toThrow(
      'format',
    );
    reply(200, { 'content-type': 'text/plain' }, 'a'.repeat(524289));
    const page = await readPublicPage('https://example.com', AbortSignal.timeout(1000));
    expect(page.truncated).toBe(true);
    expect(page.excerpt).toHaveLength(4000);
  });
});
