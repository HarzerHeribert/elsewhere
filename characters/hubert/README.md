# Hubert

Hubert is the first resident of Elsewhere. His mood, energy, interests and autobiographical memory belong here, not in the shared world protocol.

The default planner is deterministic and uses no network or model credentials. It notices observable objects, approaches and inspects them, develops small interests, returns to remembered objects, makes an actual local sketch through the world engine, rests, and occasionally reflects. It does not start external workers, send email, make payments or pretend those actions happened.

## Interests from encounters and choices

A new Hubert has no assigned hobby. Verified encounters can develop tentative tastes, and the planner sees several feasible things to do. Interests are preferences, not instructions: `reconsider` lets Hubert set a known interest aside or resume a dormant one. A deliberately parked interest stays parked when another encounter adds evidence; only a later choice resumes it. Four changes per real UTC day and a six-hour topic cooldown keep rephrasing from becoming a loop. Encounter counts, memories and evidence stay intact.

Unattended interest strength relaxes gently over simulated time (e-fold 336 hours); currently attended topics do not decay. Weak interests can become dormant and genuinely new encounters may revive naturally faded ones. Up to eight active and 72 archived summaries remain bounded. No hobby has a protected slot. The owner-requested migration removes the old excessive bird prior once while preserving Hubert's six genuine bird encounters and other history.

Living entities arrive separately in `Observation.visibleEntities`, subject to the world's range, facing and occlusion checks. Their last known sightings are private remembered observations, not live locations to chase after they leave view. A successful `inspect` of a currently visible entity within eight world units produces an authoritative `EntityEncounter`; only matching current identity, species, behavior and observation version can generate an encounter episode.

The local planner follows its initial bird preference while allowing new species and behaviors to catch its attention. Verified entity topics can develop other interests, including insects and color from the garden butterfly. Interest summaries have eight active slots, with displaced statistics retained separately; actual episodes remain in memory. Outside messages and repeated polling cannot attest to an encounter or manufacture a new interest.

Watching is bounded to three sessions per fifteen simulated minutes, with a two-minute overall cooldown and at least three minutes between new observations of the same entity. Repeating a known behavior is habituated. After six simulated hours, a familiar creature can be watched again and remembered with low salience, with no additional interest, mood or boredom novelty reward. Rest and the ordinary exploration/project loop remain available. Model proposals receive the same limited observations and attention state and are redirected when they target stale or exhausted sightings.

Entity and species cues participate in the same modest, state-sensitive memory recall as places and objects. Public memory projections retain the entity ID and source-linked episode; private sighting ledgers are not sent to visitors.

## Host lifecycle

1. `createInitialHubert(now)` creates serializable private state; apply `upgradeHubertState` when loading an older snapshot.
2. `advanceHubert(state, now)` advances time-dependent needs.
3. `chooseAction(state, observation, now)` returns `{ state, action, explanation }`; save the state checkpoint before execution.
4. Authorize and execute the action through the world/tool host.
5. `applyOutcome(state, outcome, observation, now)` records verified results, bounded state effects and source-linked memories.
6. Publish `publicCharacter`, `publicMemories` and `recalledMemory`; never serialize the private state into a visitor response.

The host should preserve one authoritative sequence, avoid interrupting movement with duplicate decisions, and persist job/outcome IDs for replay protection. Rest restores energy through elapsed time only. Guestbook text enters through `applyExternalEvent` as untrusted data with per-source and global mood-effect caps; it cannot authorize an action and is excluded from public memory and journal projections.

`chooseActionWithProvider` accepts a `DecisionProvider`, validates its returned command, and still requires the same host authorization. A model never receives direct control over its state reducer, resource limits or permissions.

## Tests

`pnpm exec vitest run characters/runtime/tests characters/hubert/tests`

These include deterministic decisions, verified outcomes, rest and repetition behavior, outside-message influence bounds, private/public separation, associative recall cooldowns and a real-world-engine local life scenario.

## Wishes and owner updates

Wishes are bounded expressions of curiosity, not guaranteed requests. `considerWish(state, observation, wallNow, world)` must receive real host wall-clock time, independent of the simulated clock. It waits for three verified episodes, allows at most three requests in any rolling seven days, enforces a 48-hour cooldown and allows at most three pending wishes. It never adds a world object, spends resources or changes mood.

`resolveWish(state, { wishId, decision, receiptId, world }, wallNow)` is a trusted owner operation, never a character tool. Fulfillment requires the precise requested object to be present in a newer world version and absent from the request's complete baseline object set. Owner receipts are idempotent. A visitor claim or model assertion cannot fulfill a wish. Declining or leaving a wish pending has no mood penalty and does not block the ordinary planner.

Reset handlers should use `preserveWishLedger(freshState, previousState)` so a reset cannot replenish real-world request limits or erase owner receipts. Public projections use `publicWishes`, which omits the internal baseline object list.

Hubert knows public place landmarks through `Observation.knownPlaces`; he does not know their hidden contents. He occasionally leaves familiar activities to explore those public destinations and remembers places only after actually arriving.

## Creature identity and voice

Hubert is an unclassified nonhuman creature native to Elsewhere: a lopsided continuous body, three paddle feet, asymmetric leaf-like listening feelers and curious eyes. `appearance.json` describes his public shape; `src/persona.ts` incorporates that description into his bounded model identity. This changes neither his save schema nor his prior experiences.

His voice is gentle, curious and observant, sometimes oddly specific. He uses natural language rather than baby talk or repeated catchphrases. Model guidance avoids invented human biographies, occupations, clothing and anatomy. His interests come from what he encounters and chooses to pursue; no hobby defines him.

Aircraft, mechanisms, sounds, gardening or reading can become interests if his encounters lead there. None is an assigned project. The current weather study remains an available, real prototype experiment; it is an intention only while actually underway, and completing it does not keep it at the top of the fallback planner.

Body-language hints are derived from actual state: low energy or rest supports a settled posture; a listening tilt requires a verified encounter whose target remains currently visible. A proposed watch alone does not fabricate a sighting. These hints never create memories or claim that a tool succeeded. Both model adapters use matching creature and wildlife guidance.

## Rest, dreaming and follow-through

Hubert dreams after at least five simulated minutes and two real minutes of continuous rest, with three new verified episodes and at most one consolidation per rolling real day. The portable runtime keeps factual episodes, revisable retrieval annotations, private fictional dreams and optional waking impulses separate. Hubert's adapter supplies a bounded deterministic fallback, style and host-owned feasible actions; Ollama, compatible and routed reflection can enrich the imagery using the same daily model allowance as waking decisions. There are no additional keys to configure.

Revisions require actual outcome evidence for the same action/target; unrelated good moods cannot explain away a rejection. Public snapshots expose coarse dreaming activity and later real actions, never dream text or private visitor notes. Short naps, restarts and resets cannot replenish the real-time/evidence fence. Source deletion prunes derived records. Waking impulses expire, can be deferred, and are rechecked against current targets, range, cooldowns and permissions before execution.

Deterministic progress tracking recognizes verified attempts, stable projects, repeated deliberation and project switching. Repetition leads to a small permitted step or deliberate deferral without another model call. Quiet watching, rest and play remain valid. This is an attention aid, not a productivity score or a new source of mood rewards.

## Planned journal and home

The current `journal` field is an automatic rolling activity/reflection log. A deliberately authored, readable notebook and a customizable home are specified in `docs/architecture/next-systems.md`, alongside bounded floor/shelf/wall space, drawings and whiteboards, meaningful object affordances and creation receipts. Hubert should choose what to keep or remove when the home fills up. These capabilities are planned; the present runtime does not yet let him write notebook pages, rearrange furniture or craft arbitrary possessions.

## Memory quality and public observations

Source episodes remain immutable evidence. New unchanged inspect/interact facts and identical retries do not create duplicate episodes; work receipts remain distinct milestones. The public projection also groups older duplicates without deleting saved history. Rejections remain private, low-salience target-specific learning and immediate last-outcome feedback, rather than public autobiographical entries. Returning to a place alone cannot continually recall every rejection. Exact legacy policy sentences are removed from presentation; canonical object corrections preserve customized content.

The planner receives typed object/entity/place offers with reach, availability, approach prerequisites, familiarity and last actual receipt. A place can be a destination without being an inspectable object. A too-distant supported activity becomes an explicit approach; the world still owns collision, reach and final admission. Repeated rest requests continue one visible rest session.

The automatic `journal` log is distinct from the new authored public `notebook`. Optional expression providers receive only explicitly projected public facts, current public tastes and two previous notes. Private guest messages, dreams, raw decision context and provider reasoning are excluded. The private broker forwards only text output deltas; the current UI displays the bounded draft through normal live snapshot refreshes, without a fake typewriter or a public inference endpoint. Completed notes retain source IDs. Abandoned, invalid, overflowing or mismatched drafts are discarded; their paid reservations remain spent.

Public authoring is bounded to eight requests per UTC day, a 20-minute real-time cooldown and actual changes to its public source facts/tastes. It shares the ordinary durable model allowance and token budgets. Entries retain the latest 32 notes. The character and Activity panels link to the notebook; canned `currentThought` and `lastReflection` values are not published as model-authored thoughts. The standard broker and direct ChatGPT adapters support expression; other adapters can implement the provider-independent port. No expression provider means an honest quiet notebook.
