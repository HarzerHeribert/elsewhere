# Elsewhere

Elsewhere is a place. Hubert is its first resident.

Hubert is a small, unclassified Elsewhere creature: a soft lopsided body, three paddle feet, asymmetric listening feelers and large curious eyes. His world model and sidebar portrait share the public appearance definition in `characters/hubert/appearance.json`. Human visitors have their own separate avatars. His voice is gentle, observant and occasionally oddly specific, with a strong fascination for birds.

This monorepo contains a working **local prototype**: a full-viewport explorable world with a workshop, courtyard, orchard, pond, library and lookout; living wildlife; overview and first-person exploration; contextual sidebar panels; encounters; real Better Auth accounts; a persistent character loop; associative memory; bounded wishes; private visitor notes; owner controls; and a small artifact Hubert can produce. The default planner is deterministic and makes **no paid requests**. A native local Ollama profile is also available.

The [feature and ownership ledger](docs/architecture/features.md) distinguishes working capabilities from agreed next work and records which repeated ideas share one system.

## Run locally

Requirements: Node.js **22.x, at least 22.13** (tested with 22.22.3) and pnpm **11.1.2**. Docker and API keys are not required.

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The API listens on **127.0.0.1:4000**. The world continues while the server runs, even with no visitor page open. Stopping the process stops the local simulation; restarting resumes the last committed state without inventing offscreen experiences.

To run Hubert with the local Ollama model instead:

```sh
# Already downloaded and tested in this checkout; needed only on a fresh machine:
ollama pull qwen3:4b
pnpm ollama:check
pnpm dev:ollama
```

Run either `pnpm dev` or `pnpm dev:ollama`, not both on the same ports. Ollama must be running on localhost:11434. Qwen3 4B is a roughly 2.5 GB quantized download; it is a deliberately small test model. The local profile uses constrained JSON actions, no API key, and no cloud model requests. `pnpm ollama:check` performs one real inference and reports its action and elapsed time.

To use owner controls, run this in a second terminal:

```sh
pnpm owner
```

Open the private link it prints. It supplies a generated owner credential through the URL fragment, which the page removes and stores in this tab's session storage. Do not share the owner link. Public visitors can observe and leave bounded messages; pause, resume, advance and reset require owner authorization.

No `.env` file is needed. Copy `.env.example` to `.env` only to override settings. Credentials and lived state belong in ignored local storage, never Git. Node currently prints an experimental warning for its built-in SQLite module. World snapshots use that module; Better Auth uses its own SQLite adapter. The local profile needs no Docker or external database.

## Guided private setup

The offline [HTML setup guide](docs/setup/index.html) explains what to create in each provider account, which scopes to choose and which connections are still planned. Open it on macOS with `pnpm run setup guide`, or open the HTML file directly in a browser. It has no credential form or external assets.

```sh
pnpm run setup                # Interactive service selection; secret prompts hide input
pnpm run setup model          # Optional chat-completions model profile
pnpm dev:configured           # Explicitly run Hubert using that saved model
pnpm run setup stripe         # Stage a restricted Stripe sandbox key (rk_test_ only)
pnpm run setup email          # Stage a domain-scoped Resend sending key and sender address
pnpm run setup status         # Saved/missing/unsafe status; no key values
```

Setup makes no provider requests and preserves existing `.env`, owner credentials and world state. It saves each service separately in `.data/credentials/<character>/<service>.json`, using private macOS/Linux file permissions (700 directories, 600 files). This is **plaintext local development storage**, not an encrypted vault. The directory is ignored by Git; exclude it from support uploads, worker workspaces and shared backups. Symlinked/shared storage is refused. Existing records require explicit replacement confirmation. A key's format does not prove its provider permissions or validity.

Only `pnpm dev:configured` reads Hubert's saved model profile; its key is delivered to the API child, not the Vite child. Existing `.env` model configuration still applies to ordinary launches. A cloud model can receive recent private visitor notes; set a provider-side currency limit as well as the local call allowance.

**Stripe and email are staged only:** no payment, webhook, outgoing mail, inbound inbox, Better Auth verification delivery or connector grant is enabled. Cloud delivery is not implemented yet; hosted secrets must be installed in the specific deployment's secret store later. No GitHub personal token, cloud administrator key or live Stripe key is needed now. `--character another-name` saves a separate profile but does not instantiate another resident. Never paste credentials into chat, command arguments, source code or `VITE_*` variables.

## What to try

- The world fills the browser window. Use **Enter fullscreen** to hide browser chrome as well.
- Click **Enter world** or **Walk** to spawn your own exploration-only visitor. Walk with WASD, drag to look, or use **Capture mouse** for pointer-lock look. Releasing movement keys, opening panels, changing cameras, blurring or hiding the page stops movement. Mobile has directional controls.
- Switch freely between **Overview**, **Walk** and **Hubert’s eyes**. The map and object directory live in the left sidebar.
- Open **Residents**, select Hubert, or approach him on foot and press **E** to see his live stats and activity. Encounter cards use his actual public state, not fabricated dialogue.
- Open **Messages** to leave a private note; **Activity** contains public events, visit notifications and memories. The field journal in **Map** records places visited during this walk.
- Watch verified activity, mood/energy, interests and source-linked memories.
- Look for the courtyard sparrow, orchard robin, pond duck and garden butterfly. Click an animal or open **Map → Other lives here** to see its current activity. Hubert starts with a strong interest in birdwatching; actual encounters can strengthen it or develop other interests. His profile shows interest strengths and encounter counts.
- Return to the page later: objects, state and memories persist in `.data/elsewhere.sqlite`.
- Leave a note. Its raw contents remain private and cannot grant tools or change permissions.
- Use owner controls to pause, advance a step, and resume.
- After enough verified work, open the artifact shelf's SVG weather study. It uses explicitly simulated measurements, not real-world weather data.
- Watch Hubert's wishes. He can make at most three requests in a rolling seven real days, at least 48 hours apart, with at most three pending. Owner controls can decline a request or fulfill it by installing the actual requested feature in the world. Pending or declined wishes do not punish his mood.

The local demonstration uses a 3× simulation clock and makes decisions at bounded intervals. Deterministic mode follows reproducible activities; Ollama mode makes real local model proposals through the same policy checks. Wishes currently come from an experience-ranked catalog of six supported world additions, rather than unrestricted model-generated feature specifications. The character camera is real 3D; both planners currently receive structured visibility observations, **not rendered images**.

Visitor sessions are separate from resident characters. They expire after 30 minutes and permit only movement, looking and stopping. They cannot move Hubert, edit his state, install objects or use owner endpoints. Server-validated movement respects world boundaries and obstacles. Restarting the server ends ephemeral visits; Hubert's state persists. New layouts migrate older local saves without erasing his memories or creations.

The scene uses local CC0 Poly Haven trees with real trunks, branches and textured leaves, plus scanned ferns, shrubs and rocks. Stone walls, weathered timber and tiled roofs use 2K PBR surfaces; climbing leaves, window openings, textured floors and layered gardens add detail at walking height. Roofs cut away in Overview. The cloud HDR sky lights reflections, with warm sunlight, soft shadows and wooded hills. Trees switch detail by distance and repeated plants share GPU resources. Kenney furniture, lamps and small props remain. See [asset credits and provenance](docs/asset-credits.md) and [measured rendering and asset budgets](docs/architecture/verification.md).

All art is served locally, including the sky; no runtime asset CDN is required. This version uses a stable daylight look rather than a day/night lighting simulation. The distant landscape is scenery beyond the fenced playable world. Character vision still uses the authoritative structured world, so decoration does not silently introduce new character actions.

Wildlife is different from decoration: each entity has a stable identity, species or kind, current position and observable behavior owned by the world simulation. Hubert can watch creatures in sight, encode verified sightings as memories, and later recall them by entity, species or place. Watching has cooldowns and diminishing novelty; familiar birds can be revisited after six simulated hours without generating another novelty reward. The local and model-backed planners share these rules. Older saves gain wildlife and the initial bird preference through an idempotent migration that preserves existing history.

## Visitor accounts and world permissions

**Sign in** opens the Better Auth account window. Local email/password sign-up works without a third-party service; passwords require at least 12 characters. Sessions use HttpOnly cookies. Authentication lives in its own `auth.sqlite`, separate from Hubert's state, with a separately generated `auth-secret` file. Both stay in ignored `.data/`.

New accounts always start as ordinary visitors. They do not gain administration by being the first user, choosing an email address, or submitting a role. Their email and session are never published into the world snapshot. Signed-in notes are attributed privately using a stable user ID and bounded display name; the character does not receive account credentials or the user's email address.

Anonymous exploration remains available. Sign-in establishes a persistent identity; avatar position and the visit journal are still ephemeral in this version. Character-to-user email delivery, contact consent management and persistent inbox history are not connected yet.

To grant your own existing account world administration, copy its **User ID** from the account window, then run this trusted local operator command:

```sh
pnpm auth:admin <user-id>
# To revoke the database role:
pnpm auth:admin <user-id> --revoke
```

Reload the account window afterward. The role permits Elsewhere's world-management actions, not wallet, billing or character-private tools. Better Auth's account impersonation and role-management HTTP endpoints are blocked; role grants remain out of band. If an ID is explicitly configured in `AUTH_ADMIN_USER_IDS`, remove it from that configuration to revoke that override too. The existing private `pnpm owner` link remains a separate local operator option.

For a public deployment, Better Auth requires an HTTPS public URL and explicit `BETTER_AUTH_SECRET`. Password authentication stays disabled in production until an email verification delivery adapter is configured. Locally, emails remain explicitly **unverified** and no verification/reset mail is sent. See `.env.example` and `packages/auth/README.md`.

## Verify

```sh
pnpm check        # Formatting, TypeScript, unit/integration tests, production web build
pnpm smoke        # Starts an isolated API; checks real behavior and restart recovery
pnpm test:e2e     # Starts an isolated app; tests desktop/mobile browser interactions
```

Browser tests use installed Google Chrome when available. Otherwise install Playwright Chromium once:

```sh
pnpm exec playwright install chromium
```

The browser-test app uses separate ports and an isolated OS temporary directory, with a development-only test credential. Auth/world database overrides, dotenv loading, model configuration and auth identity are isolated from the operator's settings. The temporary data is removed after the run; set `ELSEWHERE_KEEP_TEST_DATA=1` to retain it explicitly. Reports stay in ignored `test-results/`. The ordinary owner's token and state are not used.

`pnpm format` applies the shared source style; `pnpm format:check` checks it. The [refinement audit](docs/architecture/refinement-audit.md) records the specialist reviews, consolidation boundaries and retained features.

On environments that restrict loopback sockets, permit localhost binding for HTTP, smoke and browser tests. None require external service credentials.

## Public deployment foundation

The public source repository is [HarzerHeribert/elsewhere](https://github.com/HarzerHeribert/elsewhere). **Cloudflare is the preferred production target:** Workers/Static Assets, a Durable Object world clock, D1 accounts and R2 storage. Those runtime adapters still need implementation and validation. The [deployment guide](docs/architecture/deployment.md) records the migration, account/API setup and the existing tested Vercel/Render/PostgreSQL alternative, including ownership/handoff and state transfer. Cloud resources have not been provisioned. Vercel remains useful for isolated previews and future resident-built apps. Both existing provider templates disable automatic Git deployment.

The [initial GitHub CI run](https://github.com/HarzerHeribert/elsewhere/actions/runs/42516776712) passed both required jobs on clean Linux runners, including the production-image handoff. Main requires checked pull requests; force pushes and deletion are blocked. Only the human operator has repository write access. The solo-maintainer ruleset requires no independent approval; production releases remain separately controlled by the operator.

```sh
pnpm audit:public        # Candidate files/private-path and targeted credential checks; no upload
pnpm build:server        # Bundled Node entry point in dist/server.mjs
docker build -t elsewhere-runtime:local-check .
pnpm smoke:deployment    # Real isolated containers: private ingress and exact life handoff
```

Production requires PostgreSQL and explicit independent owner/auth/ingress secrets. An empty hosted life is refused unless `ALLOW_NEW_LIFE=true` deliberately selects a new one. A new runtime waits for exclusive ownership before loading or ticking Hubert; the old process drains on shutdown. `/api/health` is liveness; `/api/ready` requires the private ingress and reports readiness. Snapshot export/import preserves a life without resetting allowances and refuses any populated destination. Account verification can use dedicated `AUTH_EMAIL_API_KEY` / `AUTH_EMAIL_FROM` settings; creature mail remains separate and unconnected. The guide records remaining hosted checks, backup/restore, public admission and operator-access work.

`pnpm build` emits the web bundle in `elsewhere/web/dist`. `pnpm start` runs the API/controller; it does not serve the web bundle. Deployment will configure the web host and API routing separately.

## Optional PostgreSQL profile

Both persistence implementations use the same controller contract. SQLite is the zero-setup default. To use a local PostgreSQL instance:

```sh
docker compose -p elsewhere-local -f infra/local/compose.yaml up -d --wait
```

Then set `DATABASE_URL` using the development connection string in `.env.example`, and restart the API. Choosing PostgreSQL creates a separate life in that database; it does **not** automatically import existing SQLite state.

To test the adapter without modifying existing application tables:

```sh
TEST_DATABASE_URL=postgres://elsewhere:local-development-only@127.0.0.1:5432/elsewhere pnpm test
```

The integration test creates and removes only a randomly named test schema. It skips when `TEST_DATABASE_URL` is absent. `POSTGRES_PORT=55432` can be supplied to the Docker command if port 5432 is already used; adjust the test connection accordingly.

Stop the optional database with:

```sh
docker compose -p elsewhere-local -f infra/local/compose.yaml down
```

## Optional model connection

Default `MODEL_PROVIDER=local` never calls an external model. An optional server-side chat-completions-compatible adapter is included. To enable it, supply these in `.env`:

```dotenv
MODEL_PROVIDER=compatible
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_NAME=your-model-name
MODEL_API_KEY=your-server-side-key
MODEL_MAX_CALLS_PER_DAY=100
MODEL_TIMEOUT_MS=15000
```

The endpoint must support text chat completions and JSON action responses. Invalid output, provider failure or exhausted allowance falls back to local planning. Every attempted request is durably reserved before dispatch; resetting Hubert does not replenish the same day's allowance. Dollar cost is shown as unknown rather than falsely reported as zero. This call-count allowance is **not a guaranteed currency spending cap**: also set provider-side limits.

The native `ollama` adapter uses `/api/chat` on loopback only, constrains output with a JSON schema, and disables thinking output for the small test model. The provided local development profile allows up to 1,000 local proposals per real day, with fallback to deterministic planning when the allowance is exhausted. No wallet or paid-model key is involved.

Relevant character context and recent private visitor notes can be sent to the configured model provider. No credentials are sent in model context. Network transport is HTTPS, except explicitly configured loopback development endpoints; redirects are rejected. There are no automatic retries. Response size, output tokens, input context and request duration are bounded.

Never put credentials in `VITE_*` variables: those are browser-visible. No personal login session, cloud administrator key, cryptocurrency wallet or coding subscription is needed or automatically discovered.

## Repo map

```text
elsewhere/web/             Public React/Vite/Three.js client
elsewhere/server/          World simulation, perception, commands, HTTP boundary
characters/interfaces/    Shared protocol independent of Hubert and providers
characters/runtime/       Associative retrieval, bounded context, provider contract
characters/hubert/        Hubert's identity, state, activities and decision loop
app/                      Composition root and authoritative commit lane
packages/persistence/     SQLite and PostgreSQL snapshot adapters
packages/security/        Owner credentials, trusted policy, model allowance
packages/adapters/        Model transports and shared response handling
packages/auth/            Better Auth accounts, sessions and explicit world roles
infra/local/              Optional local PostgreSQL
tests/                    Controller and browser integration checks
scripts/                  Local launcher, owner link and standalone smoke check
```

The web client uses Vite in this first interactive prototype. It is independent of the private controller and can be hosted as static files, including on Vercel. A later web framework change does not change Hubert's state or protocol. Provider deployment configuration is deferred until the deployment phase.

## Current boundaries

This is a local prototype, not a production security certification or a complete multi-tenant service. Read [SECURITY.md](SECURITY.md) and [the architecture notes](docs/architecture/local-prototype.md) before exposing it publicly.

Only Hubert is instantiated as a persistent resident. Human visitor avatars are supported separately. Owner/resident identifiers and a separate protocol establish a future expansion boundary; self-service residency and arbitrary external characters are not enabled. External coding-worker execution, real service deployment, social-account posting, image inference and wallet signing are not connected. Unsupported delegation is rejected honestly.

Persistence currently commits full snapshots plus commit metadata. World activity has a bounded recent-event window; this is not yet a permanent queryable event archive. Character memories persist separately within the private snapshot. The runtime's recent-ID deduplication window is bounded; production event delivery will need a durable receipt table/outbox.

Inventory, notification attention and hybrid memory search are recorded as proposed next systems in [the design notes](docs/architecture/next-systems.md); they are not implemented by the new sidebar.
