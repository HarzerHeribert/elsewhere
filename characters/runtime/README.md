# Character runtime

Provider-independent helpers for an optional character implementation. Elsewhere's world protocol does not require a resident to use this runtime.

- `selectAssociativeMemory` selects at most one real episode based on stable place/object/person/phrase cues. Emotional similarity is a modest ranking signal. Source episode text is never rewritten, and global/per-memory cooldowns suppress intrusive repetition.
- `buildWorkingContext` bounds the data passed to a decision provider. Full persisted state and event history are not an ever-growing prompt.
- `DecisionProvider` is a replaceable proposal interface. Its output still requires schema validation and host authorization before any tool executes.

A source event is evidence for a memory. A matching feeling with no matching recorded event never creates a recollection. Text sanitization is not permission enforcement or a substitute for escaping output.
