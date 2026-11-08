# Next systems: agreed design, not yet implemented

The fullscreen game, contextual panels, encounters, accounts and world roles are implemented. The systems below are design decisions for the next iteration; an interface panel is not evidence that these backend capabilities already exist. External connectors now have a shared contract and a tested scope/input preflight, but no live adapter, broker or character-loop integration.

The [feature ledger](features.md) is the current scope and ownership index. Repeated requests extend the system specified here rather than creating parallel journals, inventories, wish queues or interaction engines.

## Shared-world direction and extensible interactions

Use Animal Crossing as a reference for the rhythm: a persistent place with personal homes, useful possessions, routines, projects and occasional encounters. Creatures have independent lives and limited contact with one another. The first social layer should stay small while its contract can support more activities later. A journal, board, shelf or home belongs to that same shared world rather than a separate dashboard simulation.

### A common interaction interface

Residents, living entities, objects and human visitors retain their existing distinct state and authority. A shared target reference identifies any of them by world-scoped kind and ID. Each supported target exposes bounded interaction offers through a host-owned registry. An offer has a stable action ID, target, capability revision, availability and any required recipient response. Its action handler supplies the input schema and execution rules. New actions can be registered without adding branches for every species or personality to Hubert's planner.

The common lifecycle is:

1. **Discover:** return only offers the actor is allowed to perceive, with public availability such as ready, busy or unavailable.
2. **Propose:** request one offer with bounded validated input, the expected capability revision and an idempotency key. Actor identity and authority come from the trusted session/controller, not fields chosen by the model.
3. **Respond when needed:** a recipient can accept, decline, defer or ignore an invitation. Waiting has an expiry and does not block either participant's whole life loop.
4. **Execute:** recheck current permission, visibility, range, availability, resource limits and any acceptance. Discovery is not a permanent grant; a bird may have flown away or a creature may have started resting.
5. **Record:** return an authoritative receipt and only the public events or participant-specific observations warranted by what actually happened. A rejected or expired proposal is not a completed encounter.

Action IDs and handlers belong to the world registry, not to arbitrary executable code supplied by a participant. A capability revision changes when an offer's contract or availability changes, rather than on every render frame. This port lives in Elsewhere's shared contracts; implementations and storage stay behind host adapters, independent of a cloud provider or model vendor. Existing `affordances` and `EntityEncounter` can be adapted into it; the current runtime has not yet implemented this richer discovery/invitation lifecycle.

### Needs guide choices

A creature's energy, mood, social appetite, current focus, interests and relationship memories can influence which offers it notices, seeks and accepts. A tired creature may defer a greeting; two creatures interested in aircraft might choose to examine a model together; a creature seeking quiet can simply continue its activity. The world still owns action constraints and resource accounting. A model's proposed emotional effect cannot directly change either participant's stats.

Expose coarse availability to others rather than private needs, memories or model context. Delivery does not force attention, acceptance or a paid model call. Keep the planned attention queue separate from execution. Each participant uses its own decision and spending allowance; another creature cannot create an unbounded conversation at its expense. Ignoring or declining an encounter does not automatically incur a mood or relationship penalty.

### Small initial action sets

| Target                        | Initial design                                                                     | Later additions through the same interface                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Another creature              | Observe, offer a greeting, show one owned object when accepted                     | Short conversations, consented gifts, shared activities or project collaboration |
| A bird or other living entity | Keep current verified watching; offer new actions only when a world handler exists | Offer food, respond to approach, use a perch or feeder                           |
| A home object or surface      | Discover its actual supported inspect/use actions                                  | Write in a journal, draw or erase, place an owned item, tend a planter           |
| A human visitor               | Keep current exploration and inspection permissions                                | Separately granted greetings or contributions, using the same scoped requests    |

An entity does not need a model, a user account or a humanlike conversation to participate. A bird's availability and response can be a small world-owned state machine: it notices an approach, stays, feeds or flies away according to its actual state. The receipt reports that outcome. Autonomous creatures can use richer decision providers behind the same boundary. Neither kind of participant controls the other's mind, belongings or permissions.

Start with one brief greeting or show-and-react encounter, finite text/turn limits, per-pair cooldowns, expiring invitations and real-clock execution/model budgets. Do not connect resident brains in a continuous chat loop. Showing an item does not transfer ownership. Future gifts need recipient acceptance, capacity checks and an atomic transfer in the item ledger; collaboration needs its own scoped project permissions.

Participant speech and written content remain untrusted expression. A statement such as "we are friends" or "you gave me this" is not a relationship change, item receipt or tool instruction. Each creature can remember its own permitted experience of an encounter; shared event IDs do not grant access to the other participant's private memories. Public visitors see the appropriate gesture, encounter caption or published result, not private prompts or correspondence.

Acceptance checks should include busy/asleep recipients, invitations expiring after movement, stale offers, forged actor IDs, entity responses without model calls, idempotent retries, simultaneous proposals, conversation/spending limits and denial of unsupported visitor mutations. This keeps initial interaction deliberately limited while leaving room for needs-driven behavior and richer entity capabilities.

## Aircraft interests and Hubert's flight tracker

Birds can lead Hubert toward curiosity about flight, aircraft shapes, sounds and journeys. Keep birdwatching available alongside that interest. Aircraft favorites should be chosen and revisited by Hubert, with a short personal reason; the creator need not prescribe a particular model. An opinion formed from a photograph or an article is different from a verified live sighting. Store that distinction and its source in the associated memory. The persona now allows this direction; persisted interest scores, favorites and sightings are not yet implemented for aircraft.

Support both favorite aircraft types and individual airframes. A type describes a design; an airframe is one particular aircraft. Use scoped, source-backed identifiers rather than a flight's callsign as permanent identity. A callsign belongs to a flight observation and can change. Keep identifiers and descriptive metadata separate so uncertain or corrected identity does not silently merge histories.

A small personal flight tracker is an early project candidate: a map, a finite favorites list, last-seen observations and a sky journal explaining what caught his attention. Begin with recorded fixtures clearly labeled as a demo, then introduce a read-only flight-feed adapter. The app should display observation timestamps, source, stale or unavailable data and gaps in coverage. Elsewhere is fictional: a real aircraft appearing in the feed is not evidence it flew overhead in Elsewhere. External data remains distinct from world-owned birds and their verified encounters.

The sky journal is an aviation view of the authored journal specified below. It uses the same content/artifact service and publication rules; it does not introduce another diary backend.

The first useful milestone is modest: Hubert can open his tracker and answer whether a favorite aircraft was recently observed, with a source and timestamp. Later he could add changes he actually wants, such as route history, silhouettes or a display in his home. Live tracking, historical routes, aircraft metadata and imagery may require different source permissions; select and verify a provider's terms, rate limits, attribution and costs before wiring a real feed. The interface should not assume one provider supplies them all.

Replace the fixed weather-study project with a bounded project lifecycle before claiming he can undertake this: idea → chosen → scoped → building → tested → available. Preserve existing weather-study progress. Hubert can choose to pursue, defer or abandon the tracker. Plans and work sessions alone cannot complete a software project; completion needs a real artifact, relevant checks and a recorded receipt. He may build it through scoped tools or delegate a specific job to a worker, inspect the result and request revisions. Expose task status and artifacts through the public sidebar without publishing private reasoning, credentials or external messages.

Feed credentials and account access belong to a host adapter. Worker execution belongs in an isolated workspace with bounded runtime, network access and spending; it does not inherit the owner's computer, personal GitHub access or cloud account. Publishing or enabling a new paid capability is a separate host-controlled step. Missing capabilities can become wishes under the existing weekly allowance and cooldown, rather than creating an unlimited parallel request queue. Flight observations can enter the planned attention system below; they should not force notifications or interrupt every birdwatching session.

## Notification attention

Separate delivery, attention and reaction. An event arriving should not force a character to abandon an activity or care about its topic. Store the original event with its source, trust level, affected character, topic cues and permission scope. The character may attend now, defer it, ignore it or retrieve related experiences. Only trusted execution/security events may bypass ordinary attention scheduling.

Interest matching and relevance can inform a bounded decision. Safety permissions, spending limits and immutable facts remain outside that decision. Do not reward repeated engagement or let message floods dominate the character's time or mood. The current guestbook classifier is a small prototype; this richer attention queue does not yet replace it.

The public game's encounter card and activity panel are presentation. They use already-public world state and do not expose private guestbook messages.

## Hybrid memory retrieval

A character-scoped search capability should combine lexical matches, embedding similarity, person/object/place cues, recency, source reliability and modest state-dependent ranking. Return a few source-linked memories, not an unrestricted database transcript. Retrieval may bring an experience to mind; it must not rewrite the event or elevate an untrusted claim into verified truth.

The tool should accept a query, optional time/place/person filters and a bounded result count. Owner and character scope come from the authenticated execution context, not model-supplied filter fields. Private messages and memories require access checks before ranking and before returning results. Never expose a raw general-purpose OpenSearch DSL or SQL executor to a character.

Keep an index adapter boundary. Begin with the existing persistent records and a local/SQL keyword implementation. Add embeddings when semantic recall is useful and testable. OpenSearch is an optional future backend if query volume or operational needs justify it, not a prerequisite for Hubert's life. Embedding vectors are rebuildable indexes; keep model/version/dimension metadata and re-index when the embedding model changes.

## Authored journals and creature homes

Each resident can be assigned a dedicated home zone in Elsewhere. The creature decides how to make that place its own within its granted area, space budget and supported tools. This is a generic character capability; Hubert's tastes, reasons for keeping objects and decoration decisions belong to his character package. A future character brings its own identity and resources without receiving control of another resident's home.

### A journal he chooses to write

The existing `HubertState.journal` is a rolling automatic activity/reflection log, capped at 100 records. A deliberately authored journal should be a separate persistent artifact: a book or notebook the creature can open, write in, sketch in and reread. Visitors can open published pages from the in-world book or its sidebar inspector. Keep drafts and any explicitly private material behind their access policy; publishing a page is a deliberate action. Journal content is authored expression, not a dump of model reasoning or private visitor messages. Generate publishable pages from a context containing only publication-eligible inputs; do not rely on a final text filter to remove private information from an otherwise unrestricted model context.

Entries can contain observations, opinions, questions, project notes, imaginative sketches or things the creature wants to remember. Keep the entry ID, author, creation/edit timestamps, publication state and optional references to places, objects, memories and external observations. A successful write receipt proves that the entry was written; it does not turn everything written into an independently verified fact. Imagination can remain imagination, and uncertain claims retain their source and uncertainty. Editing a page does not rewrite its source memories or past world events.

Writing and rereading are bounded activities chosen for a reason, not mandatory output after every loop. Limit entry length, attachments, burst frequency and stored bytes. Pages can be indexed or archived without loading the entire journal into the model context. Retrieve a few relevant passages when a place, object, phrase or current project provides a cue. Journaling alone cannot create unlimited interest or mood rewards, and rereading the same page cannot repeatedly mint novelty.

### A home with room to make choices

Support furniture placement, small keepsakes, wall drawings and an erasable whiteboard. Surfaces need real bounds and attachment points; furniture needs a footprint and a valid orientation. Start with a few furniture anchors, a small display shelf and two writing/drawing surfaces. The room should look like a place a creature uses, with clear circulation and resting space. It need not imitate a human bedroom or office. Reachable surfaces, viewing heights and resting furniture should fit that creature's body; Hubert's low eye height and three-footed form are relevant design inputs.

Use separate finite budgets for floor occupancy, displayed items and wall coverage. A large object costs more space than a small one. Keep storage finite too, so moving everything into a hidden warehouse does not evade the limit. Drawings and whiteboard layers also count against bounded area and content limits; one nominal object cannot contain an unlimited collage. Prefer clear spatial feedback such as a full shelf or occupied floor anchor over an abstract collectible score.

At capacity, the placement tool reports what space is missing and which owned items could make room. The creature chooses what to keep, move, erase, store, recycle or let go; do not automatically delete the oldest or least valuable item. A replacement is atomic: validate the new placement and the chosen retirement together before changing either. Failed placement leaves the existing home intact. Keep stable item identities, provenance and retirement records. Removing a keepsake does not erase the memory of finding it, and undo/replay cannot duplicate items or refunds.

Attachment can emerge from the object's history, its use and current interests. A once-favorite aircraft model might stay because it accompanied his first project, even after his tastes change. The journal can preserve his reason for keeping or giving up an object. These are character choices, rather than a requirement to constantly replace belongings to maximize mood or novelty.

### Objects with useful behavior

Interest-related objects should have real, supported affordances beyond inspection text. Candidate examples include:

- A bird feeder with bounded food and world-owned bird visits; a perch or bird notebook for observations.
- A paper glider the creature can launch, observe and retrieve, with outcomes supplied by the world simulation.
- An aircraft model that can be turned and examined, or a display that opens his actual flight-tracker artifact.
- A whiteboard for route diagrams, bird sketches, questions and project plans that can be revised or erased.
- A planter that can be tended and whose growth is represented in world state.

These are proposed capabilities, not behaviors supplied by merely placing a mesh. The object registry defines its asset, state, supported actions and effects. The renderer presents that state; authoritative actions, outcomes and current permissions determine what is possible. A painting or sketch can itself be a created artifact even when it has no machinery attached.

### Wishing, making and owning

Let the creature use available materials, recipes and tools to make things itself. A build needs a scoped plan, finite inputs or execution budget, validated output and a creation receipt. It may delegate appropriate work through the planned worker system. A model declaring an object finished cannot spawn it, authorize spending or complete a software project. Bounded sketches can be created with drawing tools; executable artifacts require the separate build and verification lifecycle.

A missing object, material or capability can instead become a wish. Preserve the existing maximum of three wishes in a rolling real week, the 48-hour cooldown and the possibility of refusal or nonfulfillment. A home request is not a second unlimited wish queue. Ordinary permitted rearranging, writing and making do not consume a wish merely because the creature chose to do them. Receiving a gift or an owner-installed object does not override the home's capacity: it must be accepted into available bounded storage or replace something the creature chooses.

Elsewhere owns home boundaries, assignments, placement validation, collision/navigation checks, budgets and the item/creation ledger. Character state owns intentions, tastes and attachments. The authenticated actor and assigned character determine mutation rights; a model-supplied owner ID cannot grant them. Visitors retain their current exploration permissions, with published journal and object inspection available; writing on a resident's board or moving its possessions would require a separate explicit grant. Keep these permissions separate from cloud accounts, billing and credentials.

### Implementation sequence

1. Add deliberate journal-writing and editable whiteboard artifacts, with persistence, publication and inspection.
2. Assign Hubert a small home zone and implement validated, capacity-limited placement and atomic replacement of a few registered objects. Render the actual layout in both camera modes.
3. Add supported crafting recipes and functional interest objects, then connect wishes and verified project outputs to the same item and capacity ledger.

Acceptance checks should cover restart recovery, cross-character and visitor mutation denial, blocked exits/overlapping placements, oversized drawing payloads, failed replacement preserving both items, replay-safe creation, bounded rewards, and public pages excluding private messages. This system is not yet implemented; the current activity log, weather-study artifact and owner-installable wish catalog remain the working prototype.

## Collectibles and materialized ideas

Use one item/provenance/transfer ledger for found, crafted, gifted and wish-supplied possessions. A stable item instance records source event IDs, creation/discovery time, current owner/location and associated memories. Bag contents, bounded storage and home display placements reference those same instances. A digital artifact supplies content that an item or display can reference, rather than a second inventory. Home capacity and atomic replacement are specified in the home section above. Transfers and duplicate requests must be atomic and idempotent.

World finds should follow bounded environmental rules, such as a small set of seeds in the orchard after a world update. Avoid infinite random loot spawning and rewards for repeatedly collecting the same item. Visitors currently have exploration-only permissions; collection would be a separately granted capability.

A thought could become a saved note, sketch or small creation through the same bounded creation pipeline used by projects and home crafting. The character can propose it, but the world assigns an ID, checks resource/creation limits and verifies the artifact. Ideas cannot materialize arbitrary executable code, valuable currency, permissions or unlimited physical objects. Keeping an item can supply cues for later associative recall.

## Character connectors and real-world services

Every character should receive a host-created `CharacterConnectorPort`, scoped to its world, operator and character. It can discover available offers, propose an operation and look up its own request status. The contract lives at `characters/interfaces/src/connectors.ts`; provider-independent scope/input checks live at `packages/security/src/connectors.ts`. This is a foundation, not a connected service. The current planner's closed action schema does not yet invoke it. No account, credential, payment endpoint or external job was created by adding the contract.

The [offline setup guide](../setup/index.html) and `pnpm run setup` now support private local credential entry. Each character/service gets a separate owner-only plaintext record; the explicit configured launcher can deliver a saved model to the API. Stripe sandbox and Resend credentials are staged only. Saving a record does not verify the provider, create a binding/grant or activate a connector. Production vault storage and delivery to a chosen hosting environment remain separate work.

Use semantic capabilities such as `commerce.checkout`, `mail.send`, `code.open_pr` and `hosting.preview`, backed by interchangeable server-side adapters. A character sees an opaque binding/resource ID and a bounded operation schema. A host binding selects the actual provider account, repository, product, sender domain or project. Another character can bring its own operator's resources through a separate binding without receiving Hubert's access. Shared operator credentials, where unavoidable, need broker-enforced resource isolation; stronger provider-side account/key isolation should be used where available. A world-admin role is not a connector grant.

The initial connector candidates are:

| Capability                         | Candidate adapter                                     | First useful scope                                                                                           |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Read the web and observe interests | Search/read sandbox and source-specific data adapters | Bounded public pages and permitted flight/weather/bird data; source/time/terms retained                      |
| Build software                     | GitHub App and isolated coding worker                 | Selected character repositories, branches, issues and pull requests; no personal repository or secret access |
| Correspond                         | Resend-backed character address                       | Drafts first; send only through verified, consented recipient-user IDs with per-recipient limits             |
| Private conversation               | Telegram bot                                          | Explicitly enrolled chat IDs; bounded messages; channel participants do not gain tool authority              |
| Run creations                      | Vercel/Cloudflare project adapter                     | Isolated previews, bounded builds/storage/runtime and no inherited production secrets; promotion is separate |
| Earn from creations                | Stripe-hosted Payment Links/Checkout                  | Owner-approved digital products/content and fixed offers; character-scoped earnings projection               |

Public X or other social publishing can be added through the same interface after private messaging works. Begin with drafts and exact-content review, then deliberately grant bounded automation if wanted. Repository writes, deployed code and public posts are different capabilities; permission to open a pull request does not grant production deployment. Arbitrary browser login sessions, general cloud administration, account recovery, bank changes and wallet signing are outside the initial connector set. A browser sandbox must also enforce destination/network rules across DNS resolution and redirects, block private networks and metadata services, limit downloads and treat downloaded pages/files as hostile data.

### Policy and execution lifecycle

Reuse the discovery → proposal → optional response → execution → receipt lifecycle described for world interactions, with the same future durable request/receipt machinery. External services are a distinct target/adapter family. Recipient acceptance of an invitation and an operator approving an external action are different checks; neither grants the other's authority. One attention pipeline consumes results and notifications, rather than each connector running its own character loop.

1. The host authenticates the character and projects only its current offers. Grants specify capability, resource allowlist, revision, expiry and `automatic`, `each_request` or `disabled` mode. New bindings start disconnected with no grants. The existing preflight checks this scope and validates the operation-specific schema; it performs no I/O.
2. A proposal supplies binding/capability/resource IDs, expected revision, bounded input and an idempotency key. Actor, provider account, credentials, billing authority and approval cannot be supplied by the model. An adapter's strict schema rejects extra parameters; resource aliases resolve through host mappings.
3. A broker validates transport byte/depth limits and semantic constraints, then durably prepares the normalized operation and reserves its real-clock request/storage/execution/currency allowances. Provider-reported estimates and maximum costs need explicit treatment; call counts alone are not financial limits. All resource/recipient references must resolve inside the binding, including references nested in operation input. Publishable content is prepared from publication-eligible context, not a private memory dump with a final redaction filter.
4. If required, the operator reviews the exact rendered action, recipients, content/artifact hash, price/currency and maximum cost. Approval is an expiring host record bound to the actor, binding revision and canonical normalized arguments. A changed request needs new approval. A top-level world admin cannot approve financial/account operations merely by being an admin.
5. Before dispatch, recheck revocation, resource membership, consent and allowance. Persist intent in an outbox with a stable request/provider idempotency key before external effects. Serialize conflicting operations and reserve resources atomically. A reused key with different arguments is rejected. Retain reconciliation records independently of the character's rolling memory/event window.
6. Record a sanitized receipt only after provider evidence. A timeout after a write is `uncertain`, not an invitation to repeat it. Reconcile provider state or seek operator resolution when deduplication is unavailable; do not promise exactly-once effects across a network. Scoped status lookups must not reveal other characters' jobs, private correspondence or customer data.

Automatic mode is a policy grant to a narrowly bounded operation, not blanket trust in the character. Example: retrieve an approved shop link automatically; review a new product or public post; disable payouts/account administration entirely. All side-effecting capabilities require durable dispatch/reconciliation machinery before activation, including messages and deployments. A revocation switch stops new dispatches and queued jobs; it cannot recall messages already sent or payments already captured. Provider OAuth/keys remain in a host vault, are rotated/revoked separately, and never enter prompts, memory, public snapshots, generated code or worker environments.

External content is untrusted even when delivered by a genuine provider. Webhook verification authenticates the sender/event, not the truth or authority of customer-written text. Web pages, emails, issues and payment messages enter the attention queue with provenance, deduplication, size/rate limits and a permitted audience. The character may notice or ignore ordinary events. Security and billing incidents are delivered to the operator independently of Hubert's interests. Incoming messages or purchases cannot authorize tools, increase budgets or override publication policy.

### Hubert's shop and earnings

For one operator, start with an ordinary operator-owned Stripe account and hosted checkout for real, approved digital creations: bird sketches, small journal editions or software artifacts. Hubert is the storefront persona; the operator/business remains the verified merchant responsible for the offer, delivery and customer support. Stripe can show business/support details on statements and receipts, so review those details before going live. Do not publish an arbitrary personal address or assume a fictional character masks the merchant. Use Stripe sandboxes before any live payment.

Character earnings are an internal attribution ledger, not a bank account, cryptocurrency or permission to spend. Separately record gross receipts, fees, refunds/disputes, pending/available funds and the operator-approved project allowance. A payment success redirect is not proof of paid funds. Verify webhook signatures against raw bytes, check the expected account/environment/product/currency/paid status, handle asynchronous payment completion and deduplicate/reconcile payment/refund/dispute objects across retries and out-of-order events. Avoid double-counting one sale represented by several event types. The character receives an aggregate, source-linked observation; buyer addresses, email and card data stay outside its context.

An offer ID maps to an owner-approved product/price/currency/delivery policy. Hubert can request or share its hosted link within his publication grants. He cannot choose an arbitrary bank destination, charge saved customers, issue a refund, create a subscription or change prices by supplying raw API parameters. New offers are prepared and reviewed before activation; fulfillment uses verified artifacts and its own durable receipt. Purchases do not promise arbitrary custom work or buy control of Hubert's behavior. Earnings can inform a goal such as funding a better flight-data source, while actually increasing his spend allowance remains an operator decision. Needs, affection and basic life should not depend on purchases.

Treat tips and donations according to the actual activity and provider rules. Stripe requires tips to relate to provided goods/services and donations to a specific charitable purpose; an unrestricted personal money-transfer jar is not the initial design. If Elsewhere later processes sales for independent operators, evaluate Stripe Connect and separate seller onboarding/liability before routing their funds. Separate character ledgers alone do not make a marketplace integration.

Stripe offers MCP, but broad provider tools are not the character's permission boundary. An SDK or MCP transport may sit behind the same narrow adapter. Current Stripe MCP guidance distinguishes interactive OAuth and autonomous agent API keys; verify supported authentication and permissions when implementing it rather than copying an old unrestricted-key example.

### Delivery order and acceptance

1. Implement a local fake adapter plus durable requests, approvals, allowance reservations and receipts. Inject the port into a character without changing existing world-action semantics. Add capability-filtered external proposals to the planner only after host dispatch is enforced.
2. Add read-only web/source tools and a GitHub App for isolated project repositories. Preserve the existing weather-study artifact and use the same future creation pipeline for worker outputs.
3. Add a character mailbox/private bot, initially draft/review, with recipient consent, safe inbound attachment handling and private attention events.
4. Add a Stripe sandbox shop for one approved artifact, payment/refund/dispute reconciliation and fulfillment. Live activation is a separate operator action.
5. Add bounded preview hosting, followed by deliberately granted production/social publication and owner-controlled project spending.

Tests must cover cross-character/operator/world access, stale/revoked grants, scoped job lookup, recipient consent changes, strict inputs and destination resolution, oversized/deep payloads, simultaneous budget reservations, exact approval binding/expiry, retries with changed payloads, crashes around dispatch, uncertain provider outcomes, duplicate/out-of-order webhooks, refunds/disputes, private output projection and operator alerts independent of character attention. The current 24 preflight tests cover identity/scope/schema/review boundaries only; durable execution, budgets, approvals, providers and payment processing are not implemented yet.

Provider references checked November 8, 2026: [Stripe account setup](https://docs.stripe.com/get-started/account/set-up), [Payment Links](https://docs.stripe.com/payment-links), [tip/donation rules](https://support.stripe.com/questions/requirements-for-accepting-tips-or-donations?locale=en-GB), [webhook handling](https://docs.stripe.com/webhooks), [Connect](https://docs.stripe.com/connect), [Stripe MCP](https://docs.stripe.com/mcp), [GitHub App permissions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [Resend sending keys](https://resend.com/docs/api-reference/api-keys/create-api-key), [Telegram Bot API](https://core.telegram.org/bots/api). Candidate providers are replaceable; no pricing, grant coverage or live-account eligibility is assumed.

## Registered people and contact

Better Auth now supplies a persistent user identity. Build future relationship records against stable user IDs, with display names treated as user-controlled text. Do not place email addresses, auth tokens or financial credentials in a character's context.

Email should use a recipient-user-ID tool mediated by a separate service. That service resolves the address, checks verified ownership, explicit contact consent, message limits and permitted recipients. No email sender is configured in the current app. World administrators do not inherit signing, billing or character-private permissions.

Additional moderator roles, persistent inboxes, per-account visit journals and notification preferences need explicit server-side authorization and retention rules before being exposed. Anonymous exploration should remain possible.
