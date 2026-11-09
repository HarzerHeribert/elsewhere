# Owner ChatGPT plan connection

This optional adapter uses OpenAI's documented [open-source ChatGPT plan usage flow](https://developers.openai.com/siwc/token-sharing-open-source). It registers **Elsewhere** separately from Codex, then calls `https://api.openai.com/v1/responses` using that registration's OAuth access token. It never reads Codex authentication, browser cookies, ChatGPT conversations or ChatGPT memories. Hubert receives his existing identity and bounded world context, without a Codex coding harness.

## Connect and verify

Use Node 22 and the repository's installed dependencies. Run commands from the repository root:

```sh
pnpm chatgpt login
pnpm chatgpt status
pnpm chatgpt models
pnpm chatgpt check
```

Login opens the system browser at OpenAI's authorization endpoint. Choose the intended account/workspace, name the registration and grant ChatGPT plan usage. The loopback callback listens only on `127.0.0.1` and expires after five minutes. A denied or failed sign-in leaves existing credentials unchanged. No inference runs during login or model listing.

The check creates an in-memory world, reserves at most one inference call and validates the proposed action through the ordinary Hubert/controller/world interfaces. It cannot load or reset the saved life. It returns success only after a completed response supplies a schema-valid action; local fallback is reported as a failed model test. Each explicit invocation may consume subscription quota, including a request whose response is rejected locally. No API-key billing fallback exists.

`gpt-6-luna` is the default. The adapter verifies the selected slug against the signed-in account's model catalog before inference. If it is unavailable, it stops rather than substituting another model. To explicitly choose another listed model, use `--model <slug>` for check and dev commands.

Run the actual saved world after a successful check:

```sh
pnpm dev:chatgpt --max-calls 20
```

Stop other local Elsewhere servers before using the same ports/database. This launcher runs the existing saved life, without resetting it. It starts only the local API and Vite, with the operator profile delivered only to the API. No tokens are placed into environment variables or frontend code. Ordinary `pnpm dev` retains its configured/default provider. The OAuth setup commands do not load `.env`.

## Quota and recovery

This consumes the account's shared ChatGPT plan allowance, not API-credit grants. Eligibility for a complimentary subscription must be checked by actual authorization and inference; it is separate from the paid-subscription API-credit benefit. OpenAI can restrict usage by user, workspace, model or policy.

Before continuous use, open [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage), find Elsewhere, set an app-specific weekly share and disable additional credit use if offered. The local daily call cap is shared by decisions and dreams, persisted before dispatch and preserved across restarts/resets. It is a request cap, not a token cap or dollar budget. A cap already consumed by another provider that day is not reset when switching to this one.

The current preview requires `store:false`, `stream:true`, bounded explicit context and `instructions`/developer content instead of system-message input items. It does not accept `max_output_tokens`, sampling controls or HTTP `previous_response_id`. Luna uses reasoning effort `none` for these small proposals. We bound elapsed time, received bytes and visible output, but client cancellation is not a guaranteed upstream compute/token ceiling. Instructions use stable shared prefixes; decisions and dreams are never replayed from a response cache.

Quota/auth/policy failures persist a pause for the selected registration. Network/service/stream failures use a five-minute cooldown. Paused providers are skipped before reserving another inference call. Hubert continues with the local planner. There are no automatic request retries, model substitutions, re-login loops or API-key fallbacks.

```sh
pnpm chatgpt status
pnpm chatgpt resume     # Only after resolving the cause or intentionally retrying
pnpm chatgpt login      # Reauthorize a revoked/expired connection
pnpm chatgpt logout     # Revoke renewable session and clear local tokens
```

Logout retains the issued account/client mapping and stable host identity for later sign-in. If remote revocation cannot be confirmed, it still clears local tokens and instructs you to disconnect Elsewhere in ChatGPT settings. Refresh uses the latest rotating token, with in-process coalescing and cross-process exclusion. After a crash, a stale `.lock` file fails closed: stop all processes using that profile before investigating/removing the lock. Do not delete a lock while a session is refreshing.

Use `--profile another-name` on login, status, models, check, resume, logout or dev to keep another account/workspace registration separate. A label selects credentials; it does not grant a character access or create another resident. Returning sign-in reuses that registration's client ID and rejects a different validated identity. The CLI omits token-bearing login hints from authorization URLs.

## Security and deployment

Elsewhere visitor login (Better Auth) and owner inference authorization (ChatGPT OAuth) are separate systems. An Elsewhere administrator role does not grant model credentials. Only the trusted local composition root wires the selected profile to Hubert's decision and dream providers. There is no public OAuth, token, refresh, model-selection or arbitrary inference endpoint. Visitor notes remain untrusted prompt data; outputs must still pass character schemas, world permissions and host feasibility checks.

Records live in `.data/chatgpt/`: one stable `host.json` and one account file per profile. They are **plaintext**, protected by owner-only directories/files (`0700`/`0600`), safe-open checks and atomic replacement. They stay outside snapshots, public projections, source control and Docker build inputs. Vite denies private state/key files through its filesystem routes. Do not attach this directory to support uploads, public backups or coding-worker workspaces. Anyone who can execute code as the owning OS user can still read these credentials; file permissions do not sandbox that user.

`MODEL_PROVIDER=chatgpt` requires `HOST=127.0.0.1` and refuses production startup. For hosted Hubert, `MODEL_PROVIDER=broker` connects the world to a separate private service. The implemented [ownership and hosting guide](ownership-and-hosting.md) describes its protected disk, owner binding, independent durable allowance and explicit session handoff. Local login does not install credentials on any hosted service.

The private inference process has no public enrollment endpoint. It authenticates the world runtime using a narrow service credential and verifies the exact expected owner/world/Hubert/connection binding. The service owns OAuth tokens and refresh; the public world and workers receive neither its volume nor its credentials. Requests contain typed bounded context and fixed host-owned persona, with decision/reflection validators and independent quotas. The optional Render Blueprint and production Docker smoke tests exercise the process boundary. Live provisioning and session transfer remain explicit operator actions.

After a handoff begins, local sign-in, inference, resume and logout for that profile are disabled. This prevents two processes refreshing one rotating session or local logout revoking the hosted session. An ambiguous transfer can be retried to the same destination/owner/profile; it cannot overwrite a remotely rotated session. See the hosting guide before using `pnpm chatgpt transfer`.

Review OpenAI's [hosted eligibility](https://developers.openai.com/siwc/token-sharing-open-source) and [self-hosted VM instructions](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) for the actual offering. A self-hosted host needs its own stable host ID and protected credential transfer; do not clone the laptop's host identity or bake tokens into an image. Cloud-provider management tokens and credits do not authorize OpenAI inference. Cloudflare startup credits exclude AI Gateway; eligible Workers AI usage is a separate future adapter/billing route.

Official protocol references: [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [sessions/refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [errors](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
