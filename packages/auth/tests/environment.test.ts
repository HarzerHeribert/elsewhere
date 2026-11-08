import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { authOptionsFromEnvironment } from '../src/environment';

describe('shared authentication configuration', () => {
  it('preserves explicit database isolation and configured role overrides for every entrypoint', () => {
    const options = authOptionsFromEnvironment({
      DATA_DIR: 'isolated-test-data',
      WEB_ORIGIN: 'https://world.example',
      DATABASE_URL: 'postgres://world.example/world',
      AUTH_DATABASE_URL: '',
      BETTER_AUTH_URL: 'https://accounts.example',
      BETTER_AUTH_SECRET: 'test-only-secret',
      AUTH_ADMIN_USER_IDS: ' first-user, ,second-user ',
      NODE_ENV: 'production',
    });
    expect(options).toEqual({
      dataDirectory: resolve('isolated-test-data'),
      baseURL: 'https://accounts.example',
      trustedOrigins: ['https://world.example'],
      secret: 'test-only-secret',
      databaseUrl: '',
      adminUserIds: ['first-user', 'second-user'],
      production: true,
    });
  });

  it('allows an explicit host email adapter without discovering credentials or creating one', () => {
    const sendVerificationEmail = async () => {};
    expect(authOptionsFromEnvironment({}, { sendVerificationEmail }).sendVerificationEmail).toBe(
      sendVerificationEmail,
    );
    expect(authOptionsFromEnvironment({}).sendVerificationEmail).toBeUndefined();
  });
});
