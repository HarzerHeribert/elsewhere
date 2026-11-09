import { randomBytes } from 'node:crypto';
import { devNull } from 'node:os';

export interface IsolatedAppOptions {
  dataDirectory: string;
  port: number;
  webPort?: number;
  ownerToken: string;
  tickIntervalMs?: number;
}

/** Test children must never discover an operator's database, credentials or dotenv file. */
export function isolatedAppEnvironment(
  options: IsolatedAppOptions,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(parent).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !/^(MODEL_|CHATGPT_|OPENAI_|INFERENCE_|HUBERT_OWNER_)/.test(entry[0]),
    ),
  );
  const webOrigin = `http://127.0.0.1:${options.webPort ?? options.port}`;
  return {
    ...inherited,
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: devNull,
    HOST: '127.0.0.1',
    PORT: String(options.port),
    ...(options.webPort ? { VITE_PORT: String(options.webPort) } : {}),
    WEB_ORIGIN: webOrigin,
    DATA_DIR: options.dataDirectory,
    DATABASE_URL: '',
    AUTH_DATABASE_URL: '',
    BETTER_AUTH_URL: webOrigin,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_ADMIN_USER_IDS: '',
    AUTH_EMAIL_API_KEY: '',
    AUTH_EMAIL_FROM: '',
    API_PROXY_SECRET: '',
    ADMIN_TOKEN: options.ownerToken,
    MODEL_PROVIDER: 'local',
    MODEL_BASE_URL: '',
    MODEL_API_KEY: '',
    TICK_INTERVAL_MS: String(options.tickIntervalMs ?? 2000),
    SIMULATION_RATE: '3',
  };
}
