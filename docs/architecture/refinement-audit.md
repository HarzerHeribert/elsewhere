# Swarm refinement audit — November 8, 2026

Twelve specialist reviewers examined the repository. Eleven started without the conversation history; one reconciled the complete discussion with working code and planned features. Reviews began read-only. Fixes were assigned by file ownership, then cross-reviewed and integrated. A pre-change source/hash baseline was retained outside the checkout; normal lived-state data was not reset.

## Review coverage

| Reviewer                   | Focus                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `goldfish_interfaces`      | Shared contracts, dependencies, duplicated types and ownership            |
| `goldfish_rendering`       | 3D alignment, textures, picking, LOD and GPU lifetime                     |
| `goldfish_loop`            | Controller, needs, decisions, replay and committed state                  |
| `goldfish_security`        | Auth, public/private boundaries and request limits                        |
| `goldfish_spatial`         | Navigation, interpolation, sight, colliders and migrations                |
| `goldfish_persistence`     | SQLite/PostgreSQL contracts, isolation, artifacts and shutdown            |
| `goldfish_models`          | Provider schemas, context bounds, grounding and persona ownership         |
| `goldfish_frontend`        | Account states, request races, focus, controls and UI structure           |
| `goldfish_assets`          | Geometry/image equivalence, payload duplication and reproducible baking   |
| `goldfish_tests`           | Real rendering assertions, process lifecycle and isolated test profiles   |
| `feature_reconciliation`   | Built/planned requirements, repeated ideas and current credit assumptions |
| `goldfish_maintainability` | Module boundaries, configuration and resource ownership                   |

## Consolidated interfaces and fixes

| Area                        | Result                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Movement and sight          | One browser-safe spatial kernel; exact segment checks for visitors/residents and path connectors; reachable grid attachments; shared window apertures, pond shape and object observation anchors                                                                   |
| Public geometry             | Explicit projections preserve spatial versions, apertures, footprints and elevation through both controller and HTTP boundaries while withholding private inspection detail                                                                                        |
| Saved layouts               | Additive/idempotent migration preserves custom places, obstacles, metadata, memories, creations and wish history                                                                                                                                                   |
| Controller consistency      | Public reads use committed state; closing blocks new mutations, drains accepted work and closes storage once; legacy completed artifact samples freeze during migration                                                                                            |
| Model contract              | One validated action vocabulary, schema-derived provider constraints/instructions, shared bounded response parsing and usage normalization; destination XOR and nonempty identifiers validated                                                                     |
| Model behavior              | Generic transports use character-owned identity; structured bounded planning context includes knowledge, visits, project progress and cooldowns; mandatory rest avoids unused call reservations; unknown targets fall back; verified watching has matching posture |
| Native schema compatibility | Complete schema-derived move alternatives avoid a permissive union in Ollama's grammar conversion; a real local proposal was used directly and completed in the world                                                                                              |
| Renderer lifetime           | Explicit scoped resources and loader-owned shared assets; detaching an instance does not dispose another instance's geometry; removed visitors and unique resources are released                                                                                   |
| Picking and placement       | Hidden fallbacks/LOD/decorations do not intercept clicks; initial/reset positions use authoritative snapshots; garden soil and planting use canonical dimensions                                                                                                   |
| Materials and models        | Shared surface loading for ground/path/hills/buildings; named object builders and explicit dependency/cleanup interfaces; all existing model URLs and visual features retained                                                                                     |
| UI composition              | Focused sidebar panels, shared modal primitive, account/snapshot/owner hooks, bounded transport and finite control intentions; App retains navigation and draft state                                                                                              |
| UI correctness              | Account capability/verification states, stale-response protection, polling timeout/recovery, focus entry/trap/restore and map-to-walk movement verified                                                                                                            |
| Request lifecycle           | Verified visitor quotas are independent of shared proxy IPs; abandoned visits expire; active HTTP handlers drain, including clients disconnected during an awaited lookup                                                                                          |
| Auth configuration          | Runtime and trusted admin CLI share environment resolution; private account DTOs are canonical and separate from public world metadata                                                                                                                             |
| Local tooling               | Consistent formatter/check; shared isolated test environment disables operator dotenv/database/credentials; test data cleanup is restricted to its own temporary directory; launcher signals supervisors once and waits for owned descendants                      |
| Feature retention           | The [feature ledger](features.md) is canonical. One authored-content service, item ledger, creation pipeline, wish ledger, attention pipeline and interaction port are specified without collapsing different lifecycles                                           |

Public speech/delegation vocabulary remains represented but policy-disabled. The current weather project and six supported wish additions remain working features. Authored notebooks, homes, inventories, richer interactions, aviation favorites/tracker, workers, external channels and wallet/cryptocurrency ambitions retain their planned status; this cleanup does not claim to have implemented them.

## Lossless asset consolidation

All twelve Poly Haven model URLs remain. Image payloads are shared through 33 local content-addressed files. Geometry buffer bytes, accessors, nodes, triangle counts, image bytes, transparency and material/sampler settings were compared with the pre-repack models. Every dependency hash and decoded image was checked. An isolated full rebake reproduced model/image bytes, and a repeat packaging pass was byte-identical.

- Model GLBs plus images: **82,149,252 → 61,143,906 bytes**, saving **21,005,346 bytes**.
- Complete retained model library including new reproducibility inputs: **82,668,796 → 61,712,733 bytes**.
- Existing low fern/shrub/rock variants remain available; no asset was removed merely because it is not currently instantiated.
- Disk savings do not imply identical cold-transfer or GPU-memory savings. The browser may decode or report cached image requests more than once; regional streaming remains future work.

See [asset credits](../asset-credits.md) for sources, hashes, transformation records and the pinned image toolchain.

## Verification and remaining limits

Executed commands and current counts are recorded in [verification.md](verification.md). Coverage includes complete local checks, actual Metal/WebGL pixels, all original browser flows and new race/recovery scenarios, autonomous ticking, restart recovery, local model inference, migration preservation and lossless asset validation.

Two optional PostgreSQL integration profiles require an explicitly supplied isolated test database and were not rerun for this pass. Production deployment, residency isolation, permanent external receipts/outbox, backups, anonymous admission/fairness controls and low-end/software-GPU performance remain separate work. No public deployment, paid request, external account, message, worker, wallet or signing service was created.
