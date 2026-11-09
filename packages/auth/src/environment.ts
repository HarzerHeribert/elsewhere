import { resolve } from 'node:path';
import type { LocalAuthOptions } from './index';

/** One configuration boundary for the application and trusted account-administration CLI. */
export function authOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv,
  overrides: Partial<LocalAuthOptions> = {},
): LocalAuthOptions {
  const origin = environment.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  return {
    dataDirectory: resolve(environment.DATA_DIR ?? '.data'),
    baseURL: environment.BETTER_AUTH_URL ?? origin,
    trustedOrigins: [origin],
    secret: environment.BETTER_AUTH_SECRET,
    databaseUrl: environment.AUTH_DATABASE_URL ?? (environment.DATABASE_URL || undefined),
    adminUserIds: environment.AUTH_ADMIN_USER_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    ...(environment.AUTH_EMAIL_MAX_PER_DAY === undefined
      ? {}
      : {
          emailDeliveryLimits: { maxPerDay: Number(environment.AUTH_EMAIL_MAX_PER_DAY) },
        }),
    production: environment.NODE_ENV === 'production',
    ...overrides,
  };
}
