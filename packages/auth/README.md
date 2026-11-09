# Elsewhere accounts

This package runs **Better Auth** with email/password sign-up, sign-in, sign-out, persisted sessions and the admin plugin's role fields. It is separate from Hubert's memories and from the local owner bearer token.

## Local use

`createLocalAuth({ dataDirectory, baseURL, trustedOrigins })` creates `auth.sqlite` and an independent high-entropy `auth-secret` in the private data directory, using restrictive file permissions. Programmatic Better Auth migrations create the required tables. Local development needs no OAuth or mail credentials; test addresses remain unverified and no mail is sent.

The API mounts `/api/auth/*` and `/api/account`. The latter returns `{ user, enabled, passwordAuthEnabled, requiresEmailVerification }`, with only the current account's ID, display name, email, verification state and effective world role. Its private email and session data never become Hubert's context or public world data.

## Private operator setup

When account verification mail is not configured, public password sign-up/sign-in stays disabled. A trusted operator with authentication database access can provision their own named admin account using `pnpm auth:operator create --input <private-identity.json> --output <new-private-signin.json>`. The input is an owner-only regular JSON file containing `email` and `name`. The command sends no mail, claims no email verification, and grants no character resource permissions. Bind the returned real user ID separately in the world's residency registry and private broker configuration.

The output file is created with mode 0600 and contains the user ID plus a private, single-use, 15-minute sign-in link. The link carries its token in the URL fragment; the web client removes it immediately, holds it only in memory, and asks the user to confirm before exchange. Successful exchange creates the ordinary Better Auth HttpOnly session; its raw token is withheld from the JSON response. One-time tokens are stored hashed and consumed atomically. Public token-generation and account-administration endpoints remain blocked, including for world admins.

Public navigation has no owner/administration entry or credential form. Authorized signed-in accounts open World settings from their own account dialog. Platform moderation and character management remain separately gated. Legacy local owner-token links work only in Vite development, and production builds ignore and discard them.

For a replacement link, run `pnpm auth:operator signin --input <private-user-id.json> --output <new-private-signin.json>` with an input containing only `userId`. Only an existing, active admin account can receive this private recovery link. In the production image use `node dist/auth-operator.mjs` with the same arguments and the runtime's normal auth/database environment. Never put the resulting URL, session cookies, database credentials or auth secret into chat, command arguments, public files, model context or character tools. After provisioning or maintenance, remove any temporary external database access rule.

The browser should use same-origin `/api` routes (the Vite development proxy provides this locally). Session cookies are HttpOnly and SameSite=Lax. Authentication changes require a trusted Origin, JSON content and a body no larger than 64 KB, received within five seconds. The Node and Request-based handlers enforce these checks, with Better Auth's own validation and database-backed rate limits underneath.

## Administration boundary

Every normal sign-up starts with role `user`, including the first account. Sign-up and profile-update requests cannot set the role.

`setWorldAdmin(userId, enabled)` is an out-of-band owner operation; it is not mounted as an HTTP endpoint. Trusted configuration can also specify explicit administrator user IDs. World administrators can perform permitted Elsewhere world controls through their sessions. They receive no cloud billing, infrastructure or wallet credentials.

**Better Auth account-administration HTTP endpoints are disabled**, including impersonation, user creation, role assignment and cross-user password changes. A world-admin role does not grant authority over other people's accounts. Role revocation is checked against current database state rather than a cached cookie role.

Existing local owner bearer authorization continues to work independently. Session-authenticated world changes additionally require a trusted Origin.

## Production prerequisites

Production authentication requires an explicit, stable `BETTER_AUTH_SECRET` and an HTTPS public base URL. Without a configured verification-email delivery callback, password authentication is disabled; anonymous world observation can remain available. Once a delivery callback is provided, production email/password sign-in requires verification. The package never prints verification links, passwords, session tokens or signing secrets.

A standard PostgreSQL connection can replace the local SQLite database through `databaseUrl`. Auth tables use an `elsewhere_auth_` prefix. Both SQLite and PostgreSQL adapters have been tested locally. The PostgreSQL integration creates a randomly named schema and verifies real sign-up, session persistence and role changes before dropping only that schema; still verify connectivity in the intended deployment before switching.

The authentication pool has at most three clients. Connection acquisition times out after five seconds; server statements and client queries are bounded at five and six seconds respectively, locks at two seconds, and idle transactions at five seconds. A stalled database therefore releases authentication admission slots instead of accumulating indefinitely. Database failures do not establish an account or grant permissions. The PostgreSQL integration also checks recovery after a deliberately held lock in its isolated schema.

## Validation

`node_modules/.bin/vitest run packages/auth/tests/auth.test.ts`

Tests use the real Better Auth handlers and temporary SQLite databases, not mocked account state. They cover session cookies and recovery, sign-in and sign-out, unprivileged and forged roles, explicit world-admin grants and revocation, blocked account administration, origin and body limits, and production defaults.

For PostgreSQL, set `TEST_AUTH_DATABASE_URL` to the isolated test database and run `node_modules/.bin/vitest run packages/auth/tests/postgres.test.ts`. It skips without that variable.

Primary implementation references:

- https://better-auth.com/docs/installation
- https://better-auth.com/docs/concepts/database
- https://better-auth.com/docs/plugins/admin
- https://better-auth.com/docs/authentication/email-password
