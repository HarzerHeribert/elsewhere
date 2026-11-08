# First public deployment

The deployment foundation is implemented and tested. The public source repository is [HarzerHeribert/elsewhere](https://github.com/HarzerHeribert/elsewhere). No cloud runtime or live connector account has been created. The operator must choose the public origin, Vercel project and Render workspace before provisioning. Applying `render.yaml` creates paid resources; confirm plan availability and credit coverage in that workspace first. The default region is Frankfurt and is a proposal, not an existing deployment.

## Topology and authority

- The public GitHub monorepo contains application code, tests and licensed assets. The human operator controls write access and production releases. Creatures get separate project repositories through their future GitHub Apps, with no infrastructure-repository or deployment credentials.
- Vercel builds the existing static client at `elsewhere/web/dist`. Its server-side `/api/*` route forwards to the configured Render origin and replaces `x-elsewhere-proxy-token` with its private environment secret. No custom proxy function is needed. Both provider templates disable automatic Git deployments; an operator promotes an exact checked commit.
- Render runs the bundled Node process in the non-root Docker image. The world and authentication records live in managed PostgreSQL, reachable through the private database URL. The Blueprint blocks external database connections. No persistent life or credential is expected on the ephemeral container filesystem.
- Cloudflare can supply DNS, private backup storage and an email adapter later. Use DNS-only records in front of Vercel initially; proxied traffic needs a separately tested client-address policy. Current provider credits and personal grant details are kept in ignored operator notes, not public source.

`vercel.json` and `render.yaml` are portable adapters around the existing shared contracts. The Docker runtime also runs on another container host with PostgreSQL. Cloudflare Durable Objects or Vercel Daemons remain possible future runtime adapters, with their own lifecycle/storage integration; the current API/clock is one authoritative process.

## Repository setup and release controls

1. Audit the local candidate tree with `pnpm audit:public`. The scanner checks tracked files as well as new candidates, refuses private/local filenames and reports a few recognizable credential patterns without printing matching values. It does not replace a complete secret scanner or manual publication review. `.data`, real env files, local grant notes, reports, screenshots/test output and personal tool/editor configuration are ignored. Retain the asset provenance/license files. No license for the operator's authored code has been selected automatically.
2. Create an empty repository at the chosen destination and publish the audited source. Only the operator/trusted maintainers receive write/admin access. Do not install creature Apps on this infrastructure repository with write permissions. `CODEOWNERS` currently names the connected operator and should be updated if a maintainer organization/team is chosen.
3. Let the first `CI` run finish. The workflow uses read-only contents permission, pinned official actions and no persisted checkout credential, deployment secret, OIDC write grant or self-hosted runner. Fork PR code runs only through `pull_request`, never privileged `pull_request_target` checkout. It checks formatting/types/tests/builds, real isolated PostgreSQL schemas, local smoke and the actual production-image handoff.
4. Apply `.github/rulesets/main.json` through repository settings or `gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/main.json`. It requires pull requests and both `Checks` and `Backend container` from the GitHub Actions App (15368), blocks deletion/force pushes and requires resolved review threads. Restrict repository write access to maintainers and enable available secret scanning/push protection.
5. The starting approval count is deliberately zero for one human maintainer, who cannot approve their own PR. CODEOWNERS requests review but is not an independent approval gate in that configuration. Once a second trusted maintainer exists, require one code-owner approval. CI remains required; production promotion remains a human operator action in either case. Creatures have neither merge authority on this repo nor release credentials.

CI configuration is prepared locally; a passing local check is not evidence that remote Actions have run. Provider dashboards and access settings remain authoritative. An operator with administrator access can change their own rules; these protections do not defend against compromise of that operator account. Require strong account authentication and keep recovery credentials outside creature access.

## Provisioning and secrets

Set the Vercel project root to the monorepo root. The committed config selects Vite and its output directory. Import the Render Blueprint after selecting its workspace and reviewing its paid plans. It creates a backend, a private PostgreSQL instance and independent random owner/auth/ingress secrets. Keep one backend replica; the database lock handles temporary overlap during a rollout.

| Setting                                 | Location              | Purpose                                                                                    |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `WEB_ORIGIN`                            | Render                | Exact public HTTPS origin, without trailing slash/path; the only production browser origin |
| `DATABASE_URL`                          | Render                | Blueprint-generated internal PostgreSQL connection string                                  |
| `ADMIN_TOKEN`                           | Render only           | Explicit owner credential; never copy into a frontend variable                             |
| `BETTER_AUTH_SECRET`                    | Render only           | Stable authentication signing secret across releases                                       |
| `API_PROXY_SECRET`                      | Render and Vercel     | Same random secret on both sides of the ingress boundary                                   |
| `ELSEWHERE_API_ORIGIN`                  | Vercel                | Render HTTPS origin, without trailing slash; no credentials/query/path                     |
| `AUTH_EMAIL_API_KEY`, `AUTH_EMAIL_FROM` | Render only, optional | Dedicated Resend account-verification sender; not a creature mailbox                       |
| `MODEL_*`                               | Render only, optional | Model adapter, allowance and credential; deterministic mode is the default                 |

Use each host's private secret settings. Never use `VITE_*`, commit actual env files or put credentials in command arguments. `infra/production/runtime.env.example` documents the backend variables; its placeholders are not deployable credentials. The local setup JSON profiles are not automatically uploaded. Missing account-mail settings keep production password signup disabled, and the frontend reports that capability honestly. Configuring both account-mail settings enables real verification delivery; no deployment check sends real mail.

Set values independently for staging and production. A preview must use its own exact public origin, database, secrets and model allowance. Do not forward previews or fork builds to production by copying its ingress secret. The proxy route requires a real Vercel environment to verify its provider-specific expansion and forwarded-header behavior; run the staging checks below before opening public traffic.

## State transfer and backups

The Blueprint defaults to `ALLOW_NEW_LIFE=false`. An empty production database is refused at startup and ownership is released; it will not silently initialize a replacement Hubert. Import the existing life before activating the runtime. If this is deliberately a new installation, explicitly set `ALLOW_NEW_LIFE=true` instead; that flag does not overwrite an existing snapshot.

Preserve the current local life before starting a fresh hosted one. For a clear handoff, pause the source through owner controls, then export it to a new private file (the parent directory must exist):

```sh
mkdir -p .data/backups
pnpm snapshot export --file .data/backups/hubert-transfer.json
```

The file contains private memories and messages, is created owner-only and cannot overwrite an existing file. Its envelope records a source version and payload hash. The hash detects corruption; import only your own trusted backups. The decoder validates/migrates through an in-memory controller without ticking or invoking a provider.

Stop the destination runtime before importing. Using an operator checkout with a private environment file holding the destination `DATABASE_URL`, import into an **empty** PostgreSQL life:

```sh
DOTENV_CONFIG_PATH=/absolute/private/destination.env pnpm snapshot import --target postgres --file .data/backups/hubert-transfer.json
```

The private connection must be reachable from that operator environment; the Blueprint blocks public database connections. Run through a controlled private-network operator session or temporarily allow only your operator IP and remove it immediately afterward. Never open the database to all IPs. An active runtime's ownership lock or any existing destination life makes import fail. If the host already initialized a life, use a separate empty database/schema; there is no destructive overwrite flag.

World transfer preserves state, memories, wishes, artifacts and actual model allowances. The destination snapshot revision starts its own commit sequence. It does not migrate local Better Auth accounts; preserve `auth.sqlite` separately and decide account migration before inviting local users to the hosted service. Managed PostgreSQL backups must cover both world and auth tables. Rehearse restoration to an isolated database before launch. R2 upload, offsite encryption/retention and automated backup verification are not implemented by the snapshot command; they remain operations work.

## Runtime ownership and rollout

Production requires PostgreSQL and explicit owner/auth/ingress secrets; ephemeral SQLite and personal Ollama endpoints are rejected. The PostgreSQL adapter acquires a session advisory lock scoped to its database/schema before loading/migrating the life. Every fenced snapshot read/write uses that same held connection. Loss of that connection permanently invalidates that process's ownership and stops admission; it cannot silently reconnect as an old owner. The next process loads committed state after acquiring the released lock. Model-call reservations remain in the life snapshot.

Render can overlap an old and new process during deployment. The new process exposes `/api/health` immediately as **liveness**, with `ready: false`; all other requests return 503 until it owns and initializes the life. Keep the Blueprint health check on this liveness path so the platform can retire the old instance. `/api/ready` and `/api/world` require the ingress secret and report service readiness separately. Expect a brief handoff interval while the previous process drains. This is not distributed active/active serving or a zero-interruption promise.

SIGTERM stops admission and ticks, drains handlers/controller work, closes auth/state storage and releases ownership. The Blueprint permits 90 seconds for shutdown. Exact state handoff, disabled unconfigured signup, blocked direct-origin access and continued activity are exercised with two real backend containers by `pnpm smoke:deployment`, after building `elsewhere-runtime:local-check` with Docker. That smoke creates/removes only its own fixture containers/network and uses ephemeral private env files, not operator configuration.

## Staging acceptance and launch

Before production promotion, verify through the actual Vercel URL that:

- API requests succeed through the routed ingress, direct backend requests fail except liveness, and client addresses are distinct across test clients. The backend trusts `x-vercel-forwarded-for` only after checking the ingress secret. Arbitrary forwarding headers are ignored.
- Authentication cookies, verification links, redirects, origins and sign-in/logout work on the public HTTPS origin, with no provider/auth/owner secret in the client bundle or response.
- The compiled 3D scene loads under the production CSP, with real assets, both camera modes, visitor walking and mobile controls. Provider route expansion/headers are a hosted check, even when local tests pass.
- A second backend waits for ownership, a release preserves the live state/allowance and rollback uses a database-compatible previous build.
- Backups restore successfully; owner access, spending caps and logs/alerts are set. Data retention/privacy notices match the actual provider behavior.

Request limits and visitor admission are still process-local. Auth rate records are database-backed; public registration fairness, cross-deployment abuse counters, stronger operator access controls and load testing remain public-launch work. Public model interaction should stay within its durable allowance and provider-side currency limits. External workers, payments, social posting and wallets remain disabled. A successful image build alone is not approval to expose unfinished connectors or private operator assets.

## Creature email and GitHub identity

Give each creature a distinct correspondence address routed to a scoped inbox. Use a separate sender/domain/key for account verification and keep operator recovery mail outside every creature inbox/context. A GitHub App supplies scoped repository access without a user login. One shared App shares its bot identity across characters; separate Apps can supply distinct bot identities when useful. A human-managed machine-user account is a separate optional choice subject to GitHub's account rules, not a prerequisite for creature email. Neither address ownership nor a public profile grants infrastructure, merge, deployment or billing authority.

Primary references checked November 8, 2026: [Vercel route/header environment expansion](https://vercel.com/docs/project-configuration/vercel-json), [Vercel client headers](https://vercel.com/docs/headers/request-headers), [Git deployment controls](https://vercel.com/docs/project-configuration/git-configuration), [Render Blueprint fields](https://render.com/docs/blueprint-spec), [Render rollout lifecycle](https://render.com/docs/deploys), [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html), [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets). Templates were checked against the official [Vercel schema](https://openapi.vercel.sh/vercel.json) and [Render schema](https://render.com/schema/render.yaml.json).
