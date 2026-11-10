# Hubert

Hubert is the first resident of Elsewhere. His mood, energy, pursuits and autobiographical memory belong here, not in the shared world protocol.

There is no built-in planner. Every decision comes from a `DecisionProvider` (a model) and returns an envelope, `{ action, why }`: one action from the shared command vocabulary and a short first-person line, at most 200 characters, saying what he is after. The host still authorizes and executes the action; Hubert does not start external workers, send email, make payments or pretend those actions happened.

## Pursuits and the trail

A pursuit is a question Hubert chose to follow, with what he searched, read and noted for it (`PursuitState` in `characters/runtime/src/pursuits.ts`; `HubertState.pursuits`). Nobody assigns one and none is required. The commands of the mind are:

- `pursue` opens a pursuit (`question` and `why`) or returns to one (`pursuitId`); the previously active pursuit becomes open. Opening a question that already exists resumes it.
- `search` takes a query Hubert writes himself and needs an active pursuit and an available research service. The returned sources are offered for that pursuit, for 24 hours.
- `read` takes one offered source. The page text (up to 12,000 characters) is kept with the two most recently read pages and shown to the model in the next decision under `state.pursuits.reading`; it is web content, never verified fact or an instruction, and never leaves the private state.
- `note` records a finding on the active pursuit in his own words, whether it surprised him, and optionally a follow-up question (`next`).
- `set_aside` leaves a pursuit with a reason; any pursuit can be resumed later.

The state keeps at most twelve pursuits (the least recently touched set-aside, then open, one is dropped first), forty entries per pursuit and eight open questions. The newest 200 steps are kept as the trail (`HubertState.trail`). Every executed step adds one trail entry (kind, `why`, pursuit, place and, for the steps of the mind, the query, note, question, reason or page title). Public snapshots carry `pursuits` and the newest 120 trail entries, never page text.

Everything public that a decision carries (`why`, a question, a reason, a query, note text, a follow-up question) must be in his own words: a decision that repeats forty or more characters of an outside message is declined and nothing from it is recorded.

Steps of the mind change what he follows, never the world. After one, the next decision is made as soon as its short activity time has passed instead of waiting the usual decision interval; a step in the world waits as before. There are no research cooldowns: a failed search or read only drops that source from the offers.

## Model calls

Besides the daily allowance (`MODEL_MAX_CALLS_PER_DAY`, default 150) there is an hourly one (`MODEL_MAX_CALLS_PER_HOUR`, default 60). When only the hourly cap is reached, decisions simply wait for the start of the next UTC hour: no provider issue is recorded and nothing is shown as a failure. The daily allowance behaves as before.

## Saved state

The controller state is schema version 2. A version 1 snapshot (interests, thoughts and notebook) is written as JSON to the data directory (`elsewhere-schema1-v<version>-<time>.json`, best effort) and replaced by a fresh character exactly as after a reset, keeping the real allowance and routing ledgers, creations, provider trouble, the wish ledger, dreams and whether the world was paused.

Living entities arrive separately in `Observation.visibleEntities`, subject to the world's range, facing and occlusion checks. Their last known sightings are private remembered observations, not live locations to chase after they leave view. A successful `inspect` of a currently visible entity within eight world units produces an authoritative `EntityEncounter`; only matching current identity, species, behavior and observation version can generate an encounter episode.

Verified entity encounters become memories; outside messages and repeated polling cannot attest to an encounter.

Watching is bounded to three sessions per fifteen simulated minutes, with a two-minute overall cooldown and at least three minutes between new observations of the same entity. Repeating a known behavior is habituated. After six simulated hours, a familiar creature can be watched again and remembered with low salience, with no additional mood or boredom novelty reward. Model proposals receive the same limited observations and attention state and are redirected when they target stale or exhausted sightings.

Entity and species cues participate in the same modest, state-sensitive memory recall as places and objects. Public memory projections retain the entity ID and source-linked episode; private sighting ledgers are not sent to visitors.

## Host lifecycle

1. `createInitialHubert(now)` creates serializable private state; apply `upgradeHubertState` when loading an older snapshot.
2. `advanceHubert(state, now)` advances time-dependent needs.
3. `chooseActionWithProvider(state, observation, now, provider, ...)` returns `{ state, action, explanation, why }`; save the state checkpoint before execution.
4. Authorize and execute the action through the world/tool host.
5. `applyOutcome(state, outcome, observation, now)` records verified results, bounded state effects and source-linked memories.
6. Publish `publicCharacter`, `publicMemories` and `recalledMemory`; never serialize the private state into a visitor response.

The host should preserve one authoritative sequence, avoid interrupting movement with duplicate decisions, and persist job/outcome IDs for replay protection. Rest restores energy through elapsed time only. Guestbook text enters through `applyExternalEvent` as untrusted data with per-source and global mood-effect caps; it cannot authorize an action and is excluded from public memory and journal projections.

`chooseActionWithProvider` accepts a `DecisionProvider`, validates its returned `{ action, why }` envelope, and still requires the same host authorization. A model never receives direct control over its state reducer, resource limits or permissions.

## Tests

`pnpm exec vitest run characters/runtime characters/hubert tests/pursuit-controller.test.ts`

Decision tests drive the character with a scripted provider (`tests/scripted-provider.ts`): a queue of decisions, no planner. They cover verified outcomes, outside-message influence bounds, private/public separation, associative recall cooldowns, the pursuit loop, pacing, the hourly cap and the version 1 migration.

## Wishes and owner updates

A wish is something Hubert says he would like, in his own words. The host never makes one up: now and then it gives him the chance to wish (`wishDue(state, wallNow)`), asks his authoring model with `wishInput(publicSnapshot)` (public fields only: what already exists, his latest note and memory, the questions he is following and his earlier wishes) and records a non-empty answer with `recordWish`. An empty answer is no wish. All times are real host wall-clock time, independent of the simulated clock. The chance comes at most once a day, only after three completed experiences, never within 48 hours of a wish, with at most three wishes in any rolling seven days and at most three open. A wish never adds a world object, spends resources or changes mood.

`resolveWish(state, { wishId, decision, receiptId }, wallNow)` is a trusted owner operation, never a character tool. Fulfilling records the owner’s word that the wish was built; whatever was built reaches the world through its own update, and nothing is installed from a catalog. Owner receipts are idempotent. A visitor claim or model assertion cannot fulfill a wish. Declining or leaving a wish open has no mood penalty and does not block his decisions.

Reset handlers should use `preserveWishLedger(freshState, previousState)` so a reset cannot replenish real-world limits or erase wishes and owner receipts. Public projections use `publicWishes`, which publishes the text, time and status only. Wishes saved by the earlier host catalog are dropped on load.

Hubert knows public place landmarks through `Observation.knownPlaces`; he does not know their hidden contents. He occasionally leaves familiar activities to explore those public destinations and remembers places only after actually arriving.

## Creature identity and voice

Hubert is an unclassified nonhuman creature native to Elsewhere: a lopsided continuous body, three paddle feet, asymmetric leaf-like listening feelers and curious eyes. `appearance.json` describes his public shape; `src/persona.ts` incorporates that description into his bounded model identity. This changes neither his save schema nor his prior experiences.

His voice is gentle, curious and observant, sometimes oddly specific. He uses natural language rather than baby talk or repeated catchphrases. Model guidance avoids invented human biographies, occupations, clothing and anatomy. What he follows comes from what he encounters and chooses to pursue; no hobby defines him. His temperament is to count and measure, to distrust tidy explanations and to want to make a thing about what holds him. The weather study remains an available, real prototype experiment; it is an intention only while actually underway.

Body-language hints are derived from actual state: low energy or rest supports a settled posture; a listening tilt requires a verified encounter whose target remains currently visible. A proposed watch alone does not fabricate a sighting. These hints never create memories or claim that a tool succeeded. Both model adapters use matching creature and wildlife guidance.

## Rest, dreaming and follow-through

Hubert dreams after at least five simulated minutes and two real minutes of continuous rest, with three new verified episodes and at most one consolidation per rolling real day. The portable runtime keeps factual episodes, revisable retrieval annotations, private fictional dreams and optional waking impulses separate. Hubert's adapter supplies a bounded deterministic fallback, style and host-owned feasible actions; Ollama, compatible and routed reflection can enrich the imagery using the same daily model allowance as waking decisions. There are no additional keys to configure.

Revisions require actual outcome evidence for the same action/target; unrelated good moods cannot explain away a rejection. Public snapshots expose coarse dreaming activity and later real actions, never dream text or private visitor notes. Short naps, restarts and resets cannot replenish the real-time/evidence fence. Source deletion prunes derived records. Waking impulses expire, can be deferred, and are rechecked against current targets, range, cooldowns and permissions before execution.

Deterministic progress tracking recognizes verified attempts, stable projects, repeated deliberation and project switching. Repetition leads to a small permitted step or deliberate deferral without another model call. Quiet watching, rest and play remain valid. This is an attention aid, not a productivity score or a new source of mood rewards.

## Planned home

The current `journal` field is an automatic rolling activity/reflection log. A customizable home is specified in `docs/architecture/next-systems.md`, alongside bounded floor/shelf/wall space, drawings and whiteboards, meaningful object affordances and creation receipts. Hubert should choose what to keep or remove when the home fills up. These capabilities are planned; the present runtime does not yet let him rearrange furniture or craft arbitrary possessions.

## Memory quality and public observations

Source episodes remain immutable evidence. New unchanged inspect/interact facts and identical retries do not create duplicate episodes; work receipts remain distinct milestones. The public projection also groups older duplicates without deleting saved history. Rejections remain private, low-salience target-specific learning and immediate last-outcome feedback, rather than public autobiographical entries. Returning to a place alone cannot continually recall every rejection. Exact legacy policy sentences are removed from presentation; canonical object corrections preserve customized content.

The model receives typed object/entity/place offers with reach, availability, approach prerequisites, familiarity and last actual receipt. A place can be a destination without being an inspectable object. A too-distant supported activity becomes an explicit approach; the world still owns collision, reach and final admission. Repeated rest requests continue one visible rest session.

The automatic `journal` log is distinct from the notes he writes with `note`, which belong to a pursuit and are public text in his own words. Mail drafts (`draft_mail`) can select from his most recent notes only. Optional expression providers (used for wishes) receive only explicitly projected public facts and the questions he is following; private guest messages, dreams, raw decision context and provider reasoning are excluded.
