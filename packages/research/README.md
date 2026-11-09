# Character web research

This is the first running external connector. Hubert chooses `research` for an offered public topic he has encountered, then `read` for a returned source ID. The world derives the query from trusted world data; model text, visitor notes and arbitrary URLs are not accepted as queries. Reading records a sourced, unverified memory. It does not count as seeing a bird in Elsewhere, grant permissions or award interest/mood points. Public memories expose a title and citation, never the stored page excerpt.

## Boundaries and behavior

- `characters/interfaces/src/research.ts` defines the provider-independent port, actor binding and bounded receipts. The world holds only a dedicated service credential, endpoint and optional pinned CA.
- `packages/research/src/service.ts` owns a separate SQLite ledger for one exact world/owner/character/connection. It runs the shared connector preflight, reserves operations before network I/O and caches exact requests. An interrupted request is not replayed. Changing owner requires a separate store and explicit provisioning.
- Tavily uses basic searches with automatic parameter selection, generated answers, raw pages and images disabled. Each request must report one credit. The service checks Tavily account usage before searching, accepts only a free plan with no paid allowance, and reserves at most 1,000 calls per UTC calendar month. Existing account/key usage can reduce the available allowance. Failed or ambiguous dispatched calls remain reserved. Other users of the same account can race its usage check; use a dedicated limited key and leave account pay-as-you-go disabled.
- At exhaustion, unavailable primary service or an unsafe billing configuration, search falls back to private SearXNG. Transient primary failures back off for five minutes; quota/billing ambiguity disables the primary until the next UTC month. Fallback engines can also be blocked or unavailable; the character then defers honestly.
- Defaults are 50 searches and 100 reads per UTC day, one active request, 32 one-hour cache entries, 100 discovered sources valid for 24 hours, and 2,000 idempotency records. Reservations and clock rollback fences survive restart. Cached and rejected read attempts still consume the daily operation allowance.
- `reader.ts` follows only public HTTPS URLs returned by search, resolves and pins public DNS addresses on every redirect, rejects private/link-local/reserved answers and non-443 ports, and never sends cookies or service credentials. It does not execute JavaScript or load subresources. It bounds network time, response bytes, decompression, extracted text and redirects. Some sites cannot be read this way.
- RPC requires a separate bearer and an exact owner/character binding; browser Origin requests are denied. Research credentials cannot authorize inference. There is no public visitor search endpoint.

Hubert waits at least two real minutes between research actions and six hours between searches for the same target. Reading occupies an activity interval. The last two bounded reading excerpts enter context as untrusted external data; up to 32 web-reading memories remain alongside existing life episodes. These records are factual reading receipts, not authored thoughts or proof that a page's claims are true.

## Local and portable deployment

`pnpm build:research` produces `dist/research.mjs`; `pnpm build:server` includes it. The production Docker image can run either the world, inference broker or research service with different commands, environments and volumes.

Use `infra/research/compose.yaml` as a separate Docker Compose project. Create its private interpolation file from `research.env.example`, mode 0600, outside Git. Set a real `HUBERT_OWNER_USER_ID`, fresh `RESEARCH_BROKER_TOKEN`, random `SEARXNG_SECRET`, optional `TAVILY_API_KEY`, and the checked `RESEARCH_IMAGE`. Run:

```sh
docker compose --env-file /private/path/research.env.local -f infra/research/compose.yaml config --quiet
docker compose --env-file /private/path/research.env.local -f infra/research/compose.yaml up -d --no-build
```

SearXNG has no host port. The gateway publishes only `127.0.0.1:4120`, has its own persistent volume, and receives no ChatGPT, cloud-management, GitHub or world-admin credentials. Both containers are non-root, read-only and resource-limited. Keep the host directory traversable by the container user; do not weaken private credential-file permissions.

The optional existing pinned-TLS proxy has exact research paths under the existing inference host. Supply its research bearer through a **separate Compose interpolation file**, never the inference service's `env_file`. The proxy receives service bearers only, not Tavily or ChatGPT credentials. Keep its current ingress allowlist and unrelated host services unchanged.

Configure only these values on the world runtime:

- `RESEARCH_BROKER_URL`: private HTTPS service origin, without path/query/user credentials.
- `RESEARCH_BROKER_TOKEN`: dedicated research bearer.
- `RESEARCH_BROKER_CA_PEM`: optional pinned private CA certificate.
- `RESEARCH_BROKER_ALLOW_PRIVATE_HTTP=true`: explicit local/private-network development option; unnecessary for pinned HTTPS.

Without this configuration research is unavailable and existing behavior remains runnable. Do not install `TAVILY_API_KEY` in the world, web app or inference broker. Back up the research volume together with its actor binding and usage ledger; never reset its ledger to bypass limits. Public sign-in, email, GitHub writes and general arbitrary browsing are separate capabilities.

## Verification

`pnpm test` covers actor/Origin boundaries, durable limits and ambiguous calls, primary/fallback routing, billing guards, source allowlisting, controlled-reader DNS/redirect/body checks, private-query exclusion and controller memory/activity behavior. `pnpm smoke:proxy` checks credential separation at the TLS proxy using fixtures. A live provider check must be run explicitly with private operator configuration; unit tests do not use paid credentials.
