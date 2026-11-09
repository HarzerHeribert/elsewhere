# Private inference resource limits

The broker requires both the dedicated service credential and the exact owner/world/character/connection binding. It injects its trusted persona, permits one provider request at a time, and rejects concurrent requests before reading their bodies. Liveness stays separate from provider readiness. An incomplete request body gets five seconds by default; error connections close instead of retaining an unread body.

The request allowance and usage accounting are durable and shared by decisions and dreams. Production settings can configure these defaults independently:

```dotenv
MODEL_MAX_INPUT_TOKENS_PER_DAY=3500000
MODEL_MAX_OUTPUT_TOKENS_PER_DAY=100000
MODEL_MAX_INPUT_TOKENS_PER_REQUEST=32000
MODEL_OUTPUT_TOKEN_RESERVE=2000
MODEL_MAX_UNKNOWN_USAGE_CALLS_PER_DAY=3
MODEL_REQUEST_BODY_TIMEOUT_MS=5000
```

`MODEL_MAX_CALLS_PER_DAY` remains a separate operator-selected ceiling. The owner-approved deployed value is not reset by this change. Neither prompts nor HTTP callers can modify these settings.

Before provider dispatch, the broker checks reported daily usage plus retained unknown-usage reservations and the next request's reservation. The input reservation uses serialized model-message UTF-8 bytes plus framing allowance, capped at 32,000 by default. This is a conservative admission estimate, not the provider's tokenizer. The output reservation defaults to 2,000 tokens. A known usage report replaces the pending reservation with its actual input/output counts. Cached input counts toward the full input budget.

Missing usage retains the input/output reservation and increments an unknown-usage counter. Three such calls close the circuit until the next UTC day. A pending reservation found after restart is charged once as unknown. Clock rollback cannot reopen an earlier allowance. Calls that fail after reservation are never refunded. A revoked grant or other pre-dispatch refusal retains its call reservation but does not invent provider token usage.

The version-one ledger keeps its binding, calls and reported tokens. Its optional `accounting` record stores the day, unknown-call count, unreported input/output charges and any pending reservation. Old ledgers gain this record without resetting their existing allowance. Previously unreported historical usage cannot be reconstructed by migration.

These are admission safeguards, not a hard monetary or provider-generation ceiling. Actual usage arrives after inference, so the final admitted call can exceed a daily token threshold before further calls are blocked. The output reservation does not set a provider output limit, and no unsupported `max_output_tokens` parameter or API-key billing fallback is added. Provider-side subscription limits still apply.

## Public expression workload

The optional `model.expression` capability and exact `/v1/expression` RPC share the same owner/character binding, concurrency, durable call reservations and token admission as decisions/reflection. Inputs use a strict public-facts schema with no private messages, memories, dreams, identity overrides or operator keys. Only `response.output_text.delta` is forwarded as bounded NDJSON; reasoning, refusal and tool events are excluded. A completed matching plain-text note is required before durable publication. Disconnections abort upstream work and retain spent/unknown usage accounting. Missing expression support denies admission without charging. Existing decision/reflection transports remain compatible.

Malformed action replies return `invalid_action` with a small allowlist of diagnostic field names and charged usage. They do not pause the transport connection. Raw provider bodies and private prompts are never returned in these diagnostics. World hosts reconsider at their normal decision interval, stop after three consecutive unusable proposals, and keep genuine network/authentication failures gated behind owner recovery.

Responses decisions request strict Structured Outputs rather than relying on prose instructions to produce JSON. The transport wraps the shared action vocabulary in `{ "action": ... }` because OpenAI disallows `anyOf` at the schema root. Optional command fields become complete alternatives; the canonical action validator, movement/affordance checks and policy remain authoritative after unwrapping. The envelope is private transport data, never public speech. Unsupported schemas, refusals, incomplete responses and malformed bodies fail visibly without unconstrained retries, JSON repair or a substitute action. Ollama/compatible decisions keep their existing direct action format, and public notebook text remains a separate plain-text workload. See the [Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
