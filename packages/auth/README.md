# Elsewhere accounts

This package runs **Better Auth** with email/password sign-up, sign-in, sign-out, persisted sessions and the admin plugin's role fields. It is separate from Hubert's memories and from the local owner bearer token.

## Local use

`createLocalAuth({ dataDirectory, baseURL, trustedOrigins })` creates `auth.sqlite` and an independent high-entropy `auth-secret` in the private data directory, using restrictive file permissions. Programmatic Better Auth migrations create the required tables. Local development needs no OAuth or mail credentials; test addresses remain unverified and no mail is sent.

The API mounts `/api/auth/*` and `/api/account`. The latter returns `{ user, enabled, passwordAuthEnabled, requiresEmailVerification }`, with only the current account's ID, display name, email, verification state and effective world role. Its private email and session data never become Hubert's context or public world data.

The browser should use same-origin `/api` routes (the Vite development proxy provides this locally). Session cookies are HttpOnly and SameSite=Lax. Authentication changes require a trusted Origin, JSON content and a body no larger than 64 KB. The Node and Request-based handlers enforce these checks, with Better Auth's own validation and database-backed rate limits underneath.

## Administration boundary

Every normal sign-up starts with role `user`, including the first account. Sign-up and profile-update requests cannot set the role.

`setWorldAdmin(userId, enabled)` is an out-of-band owner operation; it is not mounted as an HTTP endpoint. Trusted configuration can also specify explicit administrator user IDs. World administrators can perform permitted Elsewhere world controls through their sessions. They receive no cloud billing, infrastructure or wallet credentials.

**Better Auth account-administration HTTP endpoints are disabled**, including impersonation, user creation, role assignment and cross-user password changes. A world-admin role does not grant authority over other people's accounts. Role revocation is checked against current database state rather than a cached cookie role.

Existing local owner bearer authorization continues to work independently. Session-authenticated world changes additionally require a trusted Origin.

## Production prerequisites

Production authentication requires an explicit, stable `BETTER_AUTH_SECRET` and an HTTPS public base URL. Without a configured verification-email delivery callback, password authentication is disabled; anonymous world observation can remain available. Once a delivery callback is provided, production email/password sign-in requires verification. The package never prints verification links, passwords, session tokens or signing secrets.

A standard PostgreSQL connection can replace the local SQLite database through `databaseUrl`. Auth tables use an `elsewhere_auth_` prefix. Both SQLite and PostgreSQL adapters have been tested locally. The PostgreSQL integration creates a randomly named schema and verifies real sign-up, session persistence and role changes before dropping only that schema; still verify connectivity in the intended deployment before switching.

## Validation

`node_modules/.bin/vitest run packages/auth/tests/auth.test.ts`

Tests use the real Better Auth handlers and temporary SQLite databases, not mocked account state. They cover session cookies and recovery, sign-in and sign-out, unprivileged and forged roles, explicit world-admin grants and revocation, blocked account administration, origin and body limits, and production defaults.

For PostgreSQL, set `TEST_AUTH_DATABASE_URL` to the isolated test database and run `node_modules/.bin/vitest run packages/auth/tests/postgres.test.ts`. It skips without that variable.

Primary implementation references:

- https://better-auth.com/docs/installation
- https://better-auth.com/docs/concepts/database
- https://better-auth.com/docs/plugins/admin
- https://better-auth.com/docs/authentication/email-password
