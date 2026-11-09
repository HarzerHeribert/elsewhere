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

Production account email uses the dedicated `AUTH_EMAIL_API_KEY` and `AUTH_EMAIL_FROM` settings. The same sender enables verification and ten-minute, hashed, one-use sign-in links for existing accounts, including provisioned operators without passwords. Email links do not create accounts or grant character ownership. Return URLs are restricted to the public instance; successful redemption exposes only the HttpOnly session cookie. Character correspondence remains a separate connector.

## Passkeys and owner-control protection

Better Auth's matching passkey plugin is enabled without an external provider account. Enrollment requires an existing authenticated account; credentials stay bound to that account ID. Registration and sign-in require authenticator user verification (biometric/PIN) and a discoverable credential. Production uses the exact configured HTTPS origin; canonical `https://www.elswhr.dev` uses RP ID `elswhr.dev`. Development uses the configured hostname, so browser WebAuthn testing should use `localhost` rather than an IP address. The `elsewhere_auth_passkey` table and nullable server-only session assurance fields migrate with the existing auth schema. Existing sessions, roles and character ownership are preserved.

Adding a passkey does not disable email access. After successfully signing in with a passkey, an account can explicitly enable **Require passkey for owner controls** via `POST /api/auth/security/owner-passkey` with `{ "required": true }`. Both enabling and disabling require a real passkey session less than five minutes old and an enrolled credential. This setting grants no role or ownership. With protection enabled, email/password/recovery sessions may view the account and world, but session-authenticated world/character mutations and authentication-method changes require fresh passkey verification. Session assurance is stamped by the trusted session-create hook, never accepted from request bodies. Reauthentication while already signed in cannot switch to another account's passkey. Passkey verification JSON contains no session token; the HttpOnly cookie is confirmed through `/api/account`.

Policy changes and key deletion lock the user row in PostgreSQL (SQLite uses an IMMEDIATE transaction), so concurrent requests cannot enable protection while deleting its last key. Authentication-method changes are also serialized per account through their complete handler, with bounded queues (three per account, 32 total) and cleanup. This serialization assumes the platform's current single active runtime, enforced by its world ownership lease. Before horizontal auth scaling, replace that serializer with a distributed per-account lock; the database-atomic deletion/policy invariant already spans processes. Removing the final key while protection is active is refused. First verify a passkey and explicitly disable the requirement.

Lost all passkeys: a trusted operator must use private database access, during a dedicated runtime maintenance window, to run `pnpm auth:operator recover-passkeys --input <private-user-id.json> --output <new-private-signin.json> --confirm-recovery` (production image: `node dist/auth-operator.mjs` with the same arguments). Stop the dedicated Elsewhere runtime while recovering so no old credential mutation is in flight, then restart it. This operation accepts only an existing active world-admin account, removes that account's saved passkeys, clears its owner-control requirement and revokes all its sessions in one transaction before issuing a new private recovery link. It preserves the user ID, role and character bindings. There is no web or email bypass for this operation. Keep the input/output and database credentials private and close temporary database access afterward.

GitHub, Google and Apple social sign-in are supported by Better Auth but require operator-provided provider credentials. They are not activated by this change. Account linking is configured to require explicit linking while signed in; matching email addresses do not silently merge accounts or confer ownership. Login scopes must remain separate from a character's GitHub or mail connectors.

## Account-email admission

Verification and sign-in mail share a durable one-row delivery ledger. Defaults are one send per recipient per minute, three per hour, ten per UTC day, and 100 total sends per UTC day. `AUTH_EMAIL_MAX_PER_DAY` can set the global cap (bounded to 1–10,000); recipient storage is independently capped at 200 recently used HMAC identifiers and pruned on each bounded reservation. The ledger stores no recipient addresses or login tokens. SQLite reservations are atomic IMMEDIATE transactions; PostgreSQL uses a row lock. Restarting cannot replenish the allowance, and failed delivery remains charged. Throttled requests retain the same generic success response and leave existing delivered links usable. Current mail callbacks cover verification and magic-link sign-in; password-reset mail is not configured and any future reset callback must use this same admission gate. Existing IP limits remain, using only a server-owned authenticated-ingress address header, not caller-controlled forwarding headers.
