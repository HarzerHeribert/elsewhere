# First public deployment

Cloudflare is the preferred production target. The public source repository is [HarzerHeribert/elsewhere](https://github.com/HarzerHeribert/elsewhere), under the operator's personal GitHub account; no organization is required. The portable Node/PostgreSQL runtime and personal-VPS inference profile are implemented, while the Cloudflare-native runtime below remains planned adapter work. Actual resource IDs, credit eligibility, credentials and activation records belong in private operator storage.

## World with private VPS inference

Use `infra/production/render-vps.yaml` for one Render world runtime and a private PostgreSQL database while the existing personal VPS supplies inference. This profile does not add a Render inference service. Select the alternative `render-hosted.yaml` only when deliberately moving inference onto Render; never apply both profiles to create duplicate services.

Back up and validate the existing life before importing it into an empty database, retain the source, and pause the hosted copy while wiring it up. Keep `ALLOW_NEW_LIFE=false`. Provision the named human operator through the [private account command](../../packages/auth/README.md#private-operator-setup); configure its actual generated ID separately in `HUBERT_OWNER_USER_ID` on both world and broker. Email remains unverified until genuine verification delivery exists. Public password signup stays disabled without that sender. Signed-in accounts with management permission find World settings inside their account dialog; no public owner entry or credential form is exposed.

The world receives only the broker URL, dedicated service credential and optional public certificate pin. Vercel receives only `ELSEWHERE_API_ORIGIN` and `API_PROXY_SECRET`. Provider OAuth credentials remain on the private inference host. After stopping local use, perform the documented SSH/Docker session handoff, retain the VPS host identity and let that host own refreshes. Remove any temporary external database migration rule after maintenance.

Verify actual same-origin API responses through Vercel, denial of unauthenticated direct-origin access, private owner capabilities, guest walking, a bounded real model action, and persisted state/allowance through a runtime restart before resuming ordinary life. Deployment alone does not enable payment, wallet, social publishing, mail or coding-worker connectors.

## Preferred Cloudflare deployment

Put the world runtime, storage and ordinary model usage on Cloudflare. Use Vercel for isolated previews and future resident-built apps, with its AI Gateway as an optional model route. Preserve the tested Docker/PostgreSQL path as a portable alternative. Provider credit expiration does not require consuming unused allowances or duplicating live infrastructure.

| Responsibility                            | Preferred service                                                   | Implementation status                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Public world and same-origin API          | Workers with Static Assets                                          | Existing Vite client reusable; Worker transport/routing adapter needed                                  |
| Authoritative world and character clock   | SQLite-backed Durable Object with alarms                            | Controller reusable after import-boundary audit; persistence and lifecycle adapters needed              |
| Accounts, sessions and world roles        | D1 with Better Auth                                                 | D1 supports Better Auth; current Node/PostgreSQL integration and role helpers must be ported and tested |
| Larger assets and public creations        | R2 through explicit public projections                              | Storage adapter needed; separate public objects from private memories/backups                           |
| Private recovery copies                   | Private R2 bucket                                                   | Export format exists; encrypted upload, retention and isolated restore drill remain work                |
| Ordinary inference and embeddings         | Workers AI                                                          | Model adapter/structured-output evaluation needed; existing compatible/local providers remain           |
| Background jobs and external actions      | Queues/Workflows behind the existing capability contract            | Planned; does not activate email, payments, workers or social posting                                   |
| Operator access and public abuse controls | Cloudflare Access, application authorization and admission controls | Planned; authentication and authorization remain separate                                               |

Start with one authoritative world Durable Object for Hubert's existing controller. Alarms must advance the world with no browser connected. They are delivered at least once: persist a step/job identity and the model allowance reservation before dispatch, recognize completed steps on retry, and recover uncertain external results without blindly replaying a model call or tool effect. Serialize world mutations and test eviction, alarm retries, in-flight requests, deployment and restart. Do not transplant the current process's `setInterval` into an ordinary request Worker or claim exactly-once external execution.

Keep world rules, character definitions and command policy independent of Cloudflare bindings. Split storage contracts from Node-only adapters, audit shared barrel imports, add a Fetch transport alongside the Node HTTP transport, and implement the Cloudflare composition root separately. Preserve all current public/private projections, auth roles, visitor limits, wishes, memories, artifacts and model counters. Keep the existing snapshot transfer envelope; add a validated import into an empty Durable Object before moving the current life. D1 is not a PostgreSQL connection string, so the existing production entry point cannot simply be pointed at D1.

Better Auth documents D1 support, but this application's native SQLite imports, Node handlers, migrations and role administration still need adaptation. Re-run the account verification and authorization tests against local D1 before opening signup. Keep native worker bindings and provider credentials outside creature context; worker-built apps receive separate capabilities and allowances.

Cloudflare Containers can run the existing Docker image as a bridge or isolated future build worker. Their default disk is ephemeral, so they do not make the current SQLite life durable. The current production image still requires external PostgreSQL and ownership fencing. A native Durable Object is the preferred persistent world host; container snapshots or R2-mounted files are not a substitute for the tested state transaction semantics.

The current static asset tree contains 157 files totaling 91,072,445 bytes, with a largest file of 13,962,620 bytes. No individual file exceeds Workers Static Assets' 25 MiB limit. Recheck the built output during adapter validation; future larger models belong in R2 or need repacking. Assets can remain under the public same origin to preserve the current CSP and cookie boundary.

The exact grant determines covered products and balances. Do not infer that Registrar purchases, partner-model inference or gateway charges are covered by developer credits. Keep credit amounts and domain candidates out of the public repo. Authoritative Cloudflare domain availability and renewal pricing must be checked immediately before a separately selected registration.

### Account connection and staged activation

One account login or appropriately scoped operator API token is needed to use the existing credited account. Workers, D1, R2 and their bindings can then be provisioned through API/CLI without manually creating every resource in the dashboard. Billing activation, grant redemption and Registrar contact/agreement requirements may still need account-owner setup. No provider credential is installed in GitHub Actions or creature storage by this plan.

When the operator is available, connect the credited Cloudflare account, verify the grant's product coverage and expiry, then create isolated staging resources. Start with a `workers.dev` address; a purchased domain is not required to test the world. An OAuth device login can be approved from another device, although its default authorization is broader than a narrowly scoped deployment token. Keep Registrar purchase authority separate from runtime deployment credentials.

Complete the adapter and local Workers/D1/Durable Object tests first, then deploy staging, verify the existing 3D/auth/privacy flows, rehearse private state import and recovery, and promote an exact checked commit. Actual hosted network headers and account/billing settings must be read back. The current tested Node image and Postgres tests continue to run throughout the migration.

Primary references checked November 8, 2026: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Durable Object alarms and retry semantics](https://developers.cloudflare.com/durable-objects/api/alarms/), [D1](https://developers.cloudflare.com/d1/), [Better Auth databases](https://better-auth.com/docs/concepts/database), [Containers and ephemeral disk](https://developers.cloudflare.com/containers/faq/), [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/), [Registrar API prerequisites and checks](https://developers.cloudflare.com/registrar/registrar-api/). These establish service capabilities; they are not proof of this operator's credit eligibility or a deployed adapter.

## Workload model routing and caches

`packages/models/src` implements the provider-independent router, allowance functions and cache port. `RoutedDecisionProvider` connects it to the existing decision loop through the same command validation and world authorization. Deterministic mode remains the default, and the original single-provider compatible/Ollama modes remain available. Routine rest, world simulation and local rules do not require inference. Selecting a code model grants no shell or repository access.

Each host-defined workload policy has approved model aliases, capability requirements, a quality floor, output/context limits, latency allowance, request cost allowance and one or two permitted attempts. The router can favor economy, latency or quality; it uses observed latency and briefly avoids repeatedly failing profiles. Within an explicit small price tolerance, economy routing can retain a warm prefix rather than switching models. No extra model is called to decide which model to use. Quality levels and token prices are operator declarations requiring evaluation; they are not model self-ratings or current price discovery.

| Workload                 | Starting policy                                                        | Consumer status                                                             |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Next world action        | Small validated JSON model, preferably Workers AI                      | Integrated into the current controller                                      |
| Attention classification | Fast small JSON model only when deterministic checks are insufficient  | Router policy supported; attention consumer remains planned                 |
| Memory summary           | Economical text model with versioned source episodes                   | Router policy supported; summary consumer remains planned                   |
| Deliberate reflection    | Medium-quality text model at bounded intervals                         | Router policy supported; generative reflection consumer remains planned     |
| Embedding                | Dedicated embedding capability with model/dimension-version validation | Router policy supported; embedding transport/index consumer remains planned |
| Vision                   | Approved vision model for selected observations                        | Router policy supported; rendered-image consumer remains planned            |
| Coding                   | Higher-quality code-capable model for an approved bounded job          | Router policy supported; worker/executor remains unconnected                |

Enable through server-only `MODEL_PROVIDER=routed` and `MODEL_ROUTING_JSON`. The [example configuration](../../infra/production/model-routing.example.json) is a template: replace account/model placeholders, evaluate capabilities/latency and enter current conservative token rates before using it. Its numbers are illustrative, not provider quotes. Compact the JSON for host environment-size limits. Credential values live in separate environment variables whose names begin with `MODEL_`; JSON contains references such as `MODEL_CF_INFERENCE_KEY`, never keys. Only decision-route credentials are loaded by the current adapter. `pnpm run setup model` still configures the legacy single-provider path, not this multi-model catalog.

Prices are USD per million tokens. Allowances use integer micro-USD: `1000000` is $1. Reserve input using a conservative UTF-8-byte allowance plus protocol overhead, and reserve the full permitted output without assuming a cache hit. The input rate must cover the highest applicable uncached/cache-write rate; a separate cached-input rate accounts for reported reads. Each HTTP attempt, including failover, saves its call and money reservation before dispatch. Received usage reconciles it even when the output is invalid. Missing/invalid usage or uncertain failures retain the full reservation. Duplicate settlements do not refund twice; observed overruns stay charged. Reset, restart and snapshot transfer preserve the ledger. These are conservative application estimates, not invoice values or provider-enforced spending guarantees; apply provider/key currency limits too.

Caching has distinct boundaries:

- The system prefix contains stable trusted identity, policy and action schemas. Changing state, time, recalled memories and untrusted notes follow it as canonical JSON data. Context stays bounded; no everlasting transcript is introduced or padded merely to reach a cache threshold.
- `promptCache: key` supplies an opaque scoped `prompt_cache_key` only for supporting endpoints. `cloudflare` instead sends `x-session-affinity` without OpenAI-specific cache fields. `automatic` permits affinity tracking without request hints; `none` sends neither. None of these settings disables a provider's implicit caching or sets its retention policy. Support, minimum prefix length, write premiums, retention and actual savings require model-specific verification. Record actual cached-input tokens rather than claiming every warm prompt hit.
- Exact output caching is opt-in only for classification, summaries and embeddings. A key includes owner/world/character, recipient audience, full input, source revision, prompt/validator versions, model profiles and policy. Validate again on every hit. TTL, byte and entry limits bound the default local LRU; identical concurrent pure jobs can share one dispatch. Decisions, reflection, code and vision cannot opt into output replay. Similar-looking moods/observations never qualify for semantic action reuse.
- `ModelCachePort` allows a different host store without changing callers. The current default cache and latency/affinity observations are process-local optimizations; durable life, model allowances and verified memories remain in authoritative storage. Cache failure performs a fresh bounded request; allowance-storage failure stops dispatch and failover.

The known Cloudflare Gateway hostname automatically bypasses response caching, sets one gateway attempt and opts out of gateway logs for decisions. Set `gateway: cloudflare` for a custom gateway hostname. Provider prefix caching remains separate. Other gateways must have hidden retries/fallbacks and body logging reviewed before activation: application receipts count its own HTTP dispatches, not undisclosed upstream activity. Provider credentials, raw prompts and notes never belong in cache hints, public projections or diagnostic status strings.

Primary references checked November 8, 2026: [Cloudflare prefix caching and session affinity](https://developers.cloudflare.com/workers-ai/features/prompt-caching/), [Cloudflare compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [Cloudflare Gateway controls](https://developers.cloudflare.com/ai-gateway/glossary/), [OpenAI prompt caching and usage](https://developers.openai.com/api/docs/guides/prompt-caching), [Vercel compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions). No paid model or hosted cache has been activated by this implementation.

## Tested Node/PostgreSQL alternative: topology and authority

The following Vercel/Render configuration is the implemented alternative, not the preferred Cloudflare target. Applying `render.yaml` creates paid resources; confirm plan availability and credit coverage in the selected workspace first. Frankfurt is a proposed region, not an existing deployment. The remaining provisioning variables, ownership lifecycle and ingress-header policy in this guide describe this specific alternative.

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

The source was published on November 8, 2026, at commit `8b8e651692f324b4ab01f394bd6afa3ffa257029`. The [first remote CI run](https://github.com/HarzerHeribert/elsewhere/actions/runs/42516776712) passed both `Checks` and `Backend container` on clean Linux runners. Ruleset `26811018` is active on the default main branch with the requirements above and no bypass actors. Readback confirms the operator is the only collaborator, secret scanning/push protection are enabled, workflow tokens default to read-only and all external fork contributors require workflow approval. These are verified repository settings, not a hosted-world deployment.

Provider dashboards and access settings remain authoritative. An operator with administrator access can change their own rules; these protections do not defend against compromise of that operator account. Require strong account authentication and keep recovery credentials outside creature access.

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
