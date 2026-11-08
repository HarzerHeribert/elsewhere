import 'dotenv/config';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { closeApiServer, createApiServer } from '@elsewhere/server';
import { ElsewhereController, type ControllerState } from './controller';
import { appConfig } from './config';
import {
  PostgresSnapshotStore,
  SqliteSnapshotStore,
  type SnapshotStore,
} from '../packages/persistence/src/index';
import { ownerToken } from '../packages/security/src/index';
import { CompatibleDecisionProvider } from '../packages/adapters/src/models/compatible';
import { OllamaDecisionProvider } from '../packages/adapters/src/models/ollama';
import { RoutedDecisionProvider } from '../packages/adapters/src/models/routed';
import {
  CompatibleReflectionProvider,
  OllamaReflectionProvider,
  RoutedReflectionProvider,
} from '../packages/adapters/src/models/reflection';
import { parseRoutingConfig } from '../packages/models/src/config';
import { authOptionsFromEnvironment, createLocalAuth } from '../packages/auth/src/index';
import { verificationSenderFromEnvironment } from '../packages/auth/src/verification-mail';

const config = appConfig(process.env);
const directory = resolve(config.DATA_DIR);
const token = ownerToken(directory, process.env.ADMIN_TOKEN);
const lifetime = new AbortController();
let ready = false;
let auth: Awaited<ReturnType<typeof createLocalAuth>> | undefined;
let controller: ElsewhereController | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let startup: Promise<void> = Promise.resolve();
let stopping: Promise<void> | undefined;
let postgres: PostgresSnapshotStore<ControllerState> | undefined;
const store: SnapshotStore<ControllerState> = process.env.DATABASE_URL
  ? (postgres = new PostgresSnapshotStore<ControllerState>(process.env.DATABASE_URL, {
      exclusive: config.production,
      onOwnershipLost: () => {
        ready = false;
        void shutdown(1);
      },
    }))
  : new SqliteSnapshotStore<ControllerState>(resolve(directory, 'elsewhere.sqlite'));

const server = createApiServer({
  auth: {
    handle: (req, res) => auth!.handle(req, res),
    getAccount: (req) => auth!.getAccount(req),
    isWorldAdmin: (req) => auth!.isWorldAdmin(req),
    get passwordAuthEnabled() {
      return auth?.passwordAuthEnabled ?? false;
    },
    get requiresEmailVerification() {
      return auth?.requiresEmailVerification ?? false;
    },
  },
  adminToken: token,
  allowedOrigins: config.production
    ? [config.WEB_ORIGIN]
    : [config.WEB_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  proxySecret: config.production ? process.env.API_PROXY_SECRET : undefined,
  isReady: () => ready,
  getSnapshot: () => controller!.getSnapshot(),
  tick: () => controller!.step(),
  pause: () => controller!.pause(),
  resume: () => controller!.resume(),
  reset: () => controller!.reset(),
  submitMessage: (text, actor) => controller!.submitMessage(text, actor),
  getArtifact: (id) => controller!.getArtifact(id),
  resolveWish: (id, decision) => controller!.resolveWish(id, decision),
});
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;

async function initialize() {
  if (postgres && config.production) {
    while (!lifetime.signal.aborted && !(await postgres.tryAcquireOwnership())) {
      await delay(500, undefined, { signal: lifetime.signal }).catch(() => undefined);
    }
  }
  if (lifetime.signal.aborted) return;
  await postgres?.init();
  if (config.production && !config.allowNewLife && !(await store.load()))
    throw new Error(
      'Import the existing life before production startup, or explicitly set ALLOW_NEW_LIFE=true for a new life.',
    );
  auth = await createLocalAuth(
    authOptionsFromEnvironment(process.env, {
      dataDirectory: directory,
      sendVerificationEmail: verificationSenderFromEnvironment(process.env),
    }),
  );
  if (lifetime.signal.aborted) return;
  const onUsage = (input: number, output: number) => controller?.addUsage(input, output);
  const routing =
    config.MODEL_PROVIDER === 'routed'
      ? parseRoutingConfig(process.env.MODEL_ROUTING_JSON, config.production)
      : undefined;
  let routedBudget: ReturnType<ElsewhereController['modelBudget']> | undefined;
  const budget = () => (routedBudget ??= controller!.modelBudget(routing!));
  const model = routing
    ? new RoutedDecisionProvider(
        routing,
        {
          reserve: (estimate) => budget().reserve(estimate),
          settle: (id, usage, failed) => budget().settle(id, usage, failed),
        },
        process.env,
        { production: config.production },
      )
    : config.MODEL_PROVIDER === 'ollama'
      ? new OllamaDecisionProvider({
          baseUrl: process.env.OLLAMA_BASE_URL,
          model: process.env.MODEL_NAME ?? 'qwen3:4b',
          timeoutMs: Math.max(30000, config.MODEL_TIMEOUT_MS),
          onUsage,
        })
      : config.MODEL_PROVIDER === 'compatible'
        ? new CompatibleDecisionProvider({
            baseUrl: process.env.MODEL_BASE_URL ?? '',
            model: process.env.MODEL_NAME ?? '',
            apiKey: process.env.MODEL_API_KEY ?? '',
            timeoutMs: config.MODEL_TIMEOUT_MS,
            onUsage,
          })
        : undefined;
  const reflection = routing
    ? routing.policies.reflection
      ? new RoutedReflectionProvider(
          routing,
          {
            reserve: (estimate) => budget().reserve(estimate),
            settle: (id, usage, failed) => budget().settle(id, usage, failed),
          },
          process.env,
          { production: config.production },
        )
      : undefined
    : config.MODEL_PROVIDER === 'ollama'
      ? new OllamaReflectionProvider({
          baseUrl: process.env.OLLAMA_BASE_URL,
          model: process.env.MODEL_NAME ?? 'qwen3:4b',
          timeoutMs: Math.max(30000, config.MODEL_TIMEOUT_MS),
          onUsage,
        })
      : config.MODEL_PROVIDER === 'compatible'
        ? new CompatibleReflectionProvider({
            baseUrl: process.env.MODEL_BASE_URL ?? '',
            model: process.env.MODEL_NAME ?? '',
            apiKey: process.env.MODEL_API_KEY ?? '',
            timeoutMs: config.MODEL_TIMEOUT_MS,
            onUsage,
          })
        : undefined;
  controller = await new ElsewhereController(store, {
    simulationStepMs: config.TICK_INTERVAL_MS * config.SIMULATION_RATE,
    simulationRate: config.SIMULATION_RATE,
    modelProvider: model,
    reflectionProvider: reflection,
    modelMaximum: config.MODEL_MAX_CALLS_PER_DAY,
  }).init();
  ready = !lifetime.signal.aborted;
}

function startClock() {
  if (!ready) return;
  let ticking = false;
  timer = setInterval(() => {
    if (ticking || !ready) return;
    ticking = true;
    controller!
      .tick()
      .catch(() => {
        console.error('Controller stopped after a state or ownership failure.');
        ready = false;
        void shutdown(1);
      })
      .finally(() => {
        ticking = false;
      });
  }, config.TICK_INTERVAL_MS);
}

function shutdown(code = 0): Promise<void> {
  if (stopping) return stopping;
  ready = false;
  lifetime.abort();
  clearInterval(timer);
  stopping = (async () => {
    await closeApiServer(server);
    await startup.catch(() => undefined);
    if (controller) await controller.close();
    else await store.close();
    await auth?.close();
    process.exitCode = code;
  })();
  return stopping;
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

try {
  // Production exposes only liveness while the previous Render instance drains.
  if (!config.production) {
    startup = initialize();
    await startup;
  }
  if (lifetime.signal.aborted) throw new Error('Startup cancelled.');
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, () => {
      server.removeListener('error', reject);
      accept();
    });
  });
  console.log(`Elsewhere API listening on port ${config.PORT}; planner ${config.MODEL_PROVIDER}.`);
  if (config.production) {
    startup = initialize();
    await startup;
  }
  startClock();
  if (ready) console.log('Elsewhere owns its life and is ready.');
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('Import the existing life')
      ? error.message
      : 'Elsewhere startup failed. Check deployment configuration and database availability.',
  );
  await shutdown(1);
}
