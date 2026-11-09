# Local prototype architecture

Elsewhere owns the authoritative environment. Hubert owns his interpretation, private experiences and choices. The composition root coordinates both without giving a character direct access to persistence, policy or credentials.

## Execution

`app/main.ts` loads explicit environment configuration, selects a persistence adapter, initializes the controller and starts the loopback API. `app/controller.ts` serializes mutations in one lane. Each simulation tick advances time, movement and physiological variables, samples a small simulated weather service, and decides whether the current activity needs another decision.

The controller does not replan while Hubert is walking. Decisions are either deterministic local proposals or validated external-model proposals. Trusted policy checks the proposal before the world executor validates location, line of sight, proximity and available interactions. Hubert receives the verified outcome. State, memories and artifact availability are then committed together.

World ticks and character decisions have separate rates. `DECISION_INTERVAL_MS` defaults to 90,000 simulated milliseconds; production uses a 1:1 clock. Successful activities also have persisted minimum dwell windows: inspection/interaction one minute, reflection 90 seconds, work three minutes, and rest its requested duration. Ordinary decisions wait for both that window and the decision interval, as well as path completion. Movement, wildlife, needs and dream processing continue between decisions. An explicit operator step can bypass the dwell/interval for debugging, but does not interrupt an active path. Neither browser animation callbacks nor viewer presence control the simulation. These windows pace the current synchronous world operations; they do not add asynchronous external jobs.

The local fallback is a deterministic planner with preset intent text. It can explore, watch, use objects, rest and advance the supported demonstration project without a model. In model mode, the model currently proposes structured actions; the displayed intent line is still host-generated. Memory and interest changes follow verified world outcomes. A higher request allowance does not expand the action catalog or train the model's weights.

If an optional provider is used, the attempted request is first recorded durably using a wall-clock daily allowance. External call failure cannot refund the attempt through a simulated reset. Output has no authority to change policy, model allowance or owner credentials.

Mandatory rest is decided before reserving a model attempt. Public reads project the last successfully committed state, including while a provider/save is pending. Shutdown stops HTTP admission, drains current handlers and accepted controller work, then closes storage. Completed legacy artifacts freeze their available measurement samples during migration.

## State and perception

The world contains places, obstacles, interactive objects, living entities, residents and recent events. The current layout includes a workshop, courtyard, orchard, pond, library and lookout. A small grid pathfinder controls traversable movement. Observations are filtered by range, facing and occlusion; object detail is disclosed through inspection. Public-map landmarks are available without revealing hidden object contents. Spectator rendering and character/visitor cameras use the same world state, but no client camera controls the authoritative simulation.

Entities are separate from resident agents and static props. The initial ecology contains a sparrow, robin, duck and butterfly. Their stable identities, positions, elevations and behaviors advance analytically from the authoritative world clock, with consistent restart and pause behavior. The renderer interpolates those poses and adds behavior-specific animation. `Observation.visibleEntities` exposes only current visible creatures; a successful watching action produces a source-linked `EntityEncounter`, subject to current facing, occlusion, distance and affordance checks. Layout version 3 adds the ecology to existing saves without replacing their geometry or history.

Human visitors use separate ephemeral sessions with scoped credentials, server-clock movement and an exploration-only command schema. Their presence is projected into the public scene without exposing credentials. They cannot mutate resident state. Overview and first-person street view are alternative cameras on that same authoritative world.

This version supplies structured observations to the planner. Rendering images into a vision model is a future adapter, not an existing capability.

`characters/interfaces/spatial` is the browser-safe shared geometry entry point. It supplies exact movement checks, grid attachment/pathfinding and height-aware sight through explicit apertures. Public projections retain these geometry fields; rendering and simulation consume the same footprint, shape and observation anchors. The root protocol export remains compatible for server consumers, while the browser avoids loading model-validation code through that barrel.

The next interaction contract is specified in `next-systems.md`: targets expose permission-scoped offers; actors propose them; recipients can respond where appropriate; the world validates and executes the action and records a receipt. Creature needs inform selection and acceptance. Living entities can participate through lightweight world rules without model accounts. This richer interface is planned; current runtime affordances and verified entity watching remain the implemented behavior.

## Hubert

Hubert tracks mood, energy, boredom, frustration, social appetite, activities and interests. The deterministic planner provides repeatable exploration and work so local behavior can be tested without credentials. Its initial weather project is an explicit demonstration, not evidence that an unconstrained model developed an independent obsession.

Hubert is an unclassified nonhuman creature, with one continuous soft body, three paddle feet and asymmetric listening feelers. A public appearance definition supplies the renderer, portrait and persona description. The composition root also supplies his eye height to the shared world as resident metadata; both the camera and line-of-sight checks use that 0.78-unit viewpoint. Other residents can have different eye heights. This appearance update does not replace lived memories or reset needs and interests.

Birdwatching is an authored initial preference with no invented past experiences. Verified entity encounters develop interests from current world topics. New species and behaviors receive more attention than familiar sightings, while cooldowns and a small watching budget preserve other activities. A familiar bird can be revisited after six simulated hours without another novelty reward. Character profile migrations seed the preference once; existing episodes remain intact. Living entities do not receive character accounts, resource credentials or tool permissions.

Memories carry verified source events, encoding state and place/object/entity cues. Species names supply phrase cues as well. Retrieval uses matching cues, modest state similarity and recall cooldowns. Remembering an event does not rewrite its facts or award repeated mood gains. Generic memory types also accommodate person cues; this prototype does not automatically turn guestbook messages into public memories. Completed project repetition cannot produce endless milestones or mood rewards.

Wishes are experience-ranked requests from a small supported catalog. They require verified memories, target a capability absent from the world, and use a real-time rolling seven-day allowance with a 48-hour cooldown. They may remain pending indefinitely or be declined without emotional punishment. Fulfillment is an owner-authorized world update followed by verification of the newly installed object and a recorded receipt. Wish history and installed fulfilled features survive simulation resets.

The optional native Ollama adapter uses a small local Qwen3 4B model, constrained JSON output and the same external policy boundary as remote providers. It is tested with a real local inference as well as stubbed failure/security cases. Model outputs do not grant tools or alter the wish allowance.

## Data and portability

Model transports use a shared command schema and bounded payload handling, with identity and body/wildlife guidance supplied by the character package. Context is structured data: compaction shortens descriptions or removes complete entries instead of cutting serialized JSON or identifiers. A known object's remembered location and a public landmark are usable navigation knowledge; a guessed undiscovered object ID is not.

Renderer modules own their GPU resources explicitly. The surface service shares decoded texture sources; the asset loader owns cached imported resources; object builders and actors release only their own resources. Sidebar feature components, transport/session hooks and finite scene controls form separate extension points. See the [refinement audit](refinement-audit.md) and [feature ledger](features.md).

SQLite and PostgreSQL implement the same snapshot contract, including version conflicts. SQLite is the zero-setup local option. PostgreSQL integration is tested separately. Full snapshots and commit metadata are a deliberately small first implementation, not a permanent event-sourcing platform. The object/artifact storage contract and fine-grained event repository remain deployment-phase work.

World and character definitions import shared contracts rather than cloud SDKs. The optional model provider implements the runtime's decision-provider interface. The UI consumes public HTTP projections. No Cloudflare or Vercel account is required to run this repo.

## Deployment decisions still open

- Choose the production database, backup/restore procedure and migration path from local state.
- Host the public web bundle separately from the private controller, with explicit API routing and origin configuration.
- Supply real model adapters, privacy settings, pricing and provider-side spending limits.
- Introduce external coding workers only after sandbox and credential-broker controls are tested.
- Add a durable event receipt/outbox before relying on retryable external side effects.
- Add residency authorization, per-owner isolation and cost attribution before admitting other characters.
- Benchmark server-side rendering and image inference before enabling visual perception.
