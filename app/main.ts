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
import { runtimeProviders } from './providers';
import { hubertResourceRegistry } from './residency';
import { authOptionsFromEnvironment, createLocalAuth } from '../packages/auth/src/index';
import {
  verificationSenderFromEnvironment,
  signInSenderFromEnvironment,
} from '../packages/auth/src/verification-mail';
import { ResearchClient } from '../packages/research/src/client';

const config = appConfig(process.env);
const directory = resolve(config.DATA_DIR);
const registry = hubertResourceRegistry(
  config.HUBERT_OWNER_USER_ID,
  config.MODEL_PROVIDER === 'broker' ? 'chatgpt' : config.MODEL_PROVIDER,
);
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
    getSecurityState: (req) => auth!.getSecurityState(req),
    canUseOwnerControls: (req) => auth!.canUseOwnerControls(req),
    get passwordAuthEnabled() {
      return auth?.passwordAuthEnabled ?? false;
    },
    get emailLinkAuthEnabled() {
      return auth?.emailLinkAuthEnabled ?? false;
    },
    get passkeyAuthEnabled() {
      return auth?.passkeyAuthEnabled ?? false;
    },
    get requiresEmailVerification() {
      return auth?.requiresEmailVerification ?? false;
    },
  },
  adminToken: token,
  canManageCharacter: (userId, characterId) => registry.canManage(userId, characterId),
  allowedOrigins: config.production
    ? [config.WEB_ORIGIN]
    : [config.WEB_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  proxySecret: config.production ? process.env.API_PROXY_SECRET : undefined,
  isReady: () => ready,
  getSnapshot: () => controller!.getSnapshot(),
  getCharacterIssues: () => controller!.getCharacterIssues(),
  retryCharacterProvider: () => controller!.retryCharacterProvider(),
  tick: () => controller!.step(),
  pause: () => controller!.pause(),
  resume: () => controller!.resume(),
  reset: () => controller!.reset(),
  submitMessage: (text, actor) => controller!.submitMessage(text, actor),
  getArtifact: (id) => controller!.getArtifact(id),
  createCreation: (input) => controller!.createCreation(input),
  pinCreation: (id, pinned) => controller!.pinCreation(id, pinned),
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
      sendSignInEmail: signInSenderFromEnvironment(process.env),
    }),
  );
  if (lifetime.signal.aborted) return;
  const providers = runtimeProviders(config, process.env, {
    onUsage: (input, output) => controller?.addUsage(input, output),
    budgetFor: (routing) => controller!.modelBudget(routing),
  });
  controller = await new ElsewhereController(store, {
    simulationStepMs: config.TICK_INTERVAL_MS * config.SIMULATION_RATE,
    decisionIntervalMs: config.DECISION_INTERVAL_MS,
    simulationRate: config.SIMULATION_RATE,
    modelProvider: providers.model,
    reflectionProvider: providers.reflection,
    expressionProvider: providers.expression,
    modelMaximum: config.MODEL_MAX_CALLS_PER_DAY,
    research: config.RESEARCH_BROKER_URL
      ? new ResearchClient({
          url: config.RESEARCH_BROKER_URL,
          token: config.RESEARCH_BROKER_TOKEN!,
          binding: {
            worldId: 'elsewhere',
            ownerUserId: config.HUBERT_OWNER_USER_ID,
            characterId: 'hubert',
            connectionId: 'hubert-web',
          },
          caCertificate: config.RESEARCH_BROKER_CA_PEM?.replace(/\\n/g, '\n'),
          allowPrivateHttp: config.RESEARCH_BROKER_ALLOW_PRIVATE_HTTP === 'true',
        })
      : undefined,
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
