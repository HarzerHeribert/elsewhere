import { z } from 'zod';
import { isAbsolute, resolve } from 'node:path';
import { createResearchService } from '../packages/research/src/service';
import { createResearchHttpServer } from '../packages/research/src/http';
import { searchProviders } from '../packages/research/src/providers';
import { readPublicPage } from '../packages/research/src/reader';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';

process.umask(0o077);
const schema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4120),
  RESEARCH_DATA_ROOT: z.string().min(1),
  RESEARCH_BROKER_TOKEN: z.string().regex(/^[a-zA-Z0-9_-]{32,512}$/),
  HUBERT_OWNER_USER_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  TAVILY_API_KEY: z.string().min(12).max(512).optional(),
  SEARXNG_URL: z.string().url(),
  RESEARCH_TAVILY_MONTHLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(1000),
});
try {
  const config = schema.parse(process.env);
  if (
    !isAbsolute(config.RESEARCH_DATA_ROOT) ||
    (config.HUBERT_OWNER_USER_ID === 'local-owner' && process.env.NODE_ENV === 'production')
  )
    throw Error('Private research needs persistent storage and real ownership.');
  for (const name of [
    'ADMIN_TOKEN',
    'BETTER_AUTH_SECRET',
    'API_PROXY_SECRET',
    'INFERENCE_BROKER_TOKEN',
    'CHATGPT_PROFILE',
    'CLOUDFLARE_API_TOKEN',
    'VERCEL_TOKEN',
    'RENDER_API_KEY',
    'GITHUB_TOKEN',
  ])
    if (process.env[name]) throw Error('Unrelated credentials must not be installed in research.');
  const binding = {
    worldId: 'elsewhere',
    ownerUserId: config.HUBERT_OWNER_USER_ID,
    characterId: 'hubert',
    connectionId: 'hubert-web',
  };
  const service = await createResearchService({
    binding,
    store: new SqliteSnapshotStore(resolve(config.RESEARCH_DATA_ROOT, 'research.sqlite')),
    providers: searchProviders({
      tavilyKey: config.TAVILY_API_KEY,
      searxngUrl: config.SEARXNG_URL,
    }),
    reader: readPublicPage,
    monthlyTavilyLimit: config.RESEARCH_TAVILY_MONTHLY_LIMIT,
  });
  const server = createResearchHttpServer({
    service,
    binding,
    token: config.RESEARCH_BROKER_TOKEN,
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void service.close();
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, resolve);
  });
  console.log('Private character research service ready.');
} catch {
  console.error('Private research startup failed; check protected configuration and storage.');
  process.exitCode = 1;
}
