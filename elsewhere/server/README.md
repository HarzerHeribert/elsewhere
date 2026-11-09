# HTTP availability boundaries

`createApiServer` applies admission before starting public work or appending mutations to the world's serialized operation queue. These limits assume one runtime process. Multiple replicas require coordinated quotas and visitor storage before scaling out.

Public reads are bounded per trusted source and in aggregate:

| Route    | Per source/minute | Aggregate/minute |
| -------- | ----------------: | ---------------: |
| World    |               120 |            1,200 |
| Account  |                60 |              300 |
| Artifact |                30 |              120 |

Accepted public JSON/artifact payloads share a 16 MiB/minute budget, reserving up to 256 KiB before work starts and settling actual bytes before sending. Trusted host configuration can override aggregate read counts and payload bytes with `ApiDependencies.traffic`. This is not a bill or network ceiling: headers, errors, delegated authentication and provider traffic are outside that meter. Process-local windows reset on restart.

Concurrent public reads, public writes, account reads and authentication have separate bounded pools. Authenticated visitor reads and actions also have their own pools. Owner bearer controls bypass public identity tables and use reserved control capacity. Session controls have a separate bounded verification lane and must establish the real account and its permissions first; a cookie header alone grants no priority. Keep the owner bearer private for recovery during public overload. Shared TCP capacity and saturated session verification can still delay browser-based administration.

Visitor admission allows two pending or active sessions per trusted source and 64 in total. Unused registrations expire after 30 seconds. An authenticated visitor read or accepted action activates the session for five idle minutes, with a 30-minute absolute lifetime. Public polls and rejected actions do not extend it. Shared NATs share the two-session limit; sufficiently many independent sources can still exhaust the global pool. Only a successful explicit world reset clears the registry; pause, resume and failed resets preserve it.

Production proxy trust must remain enabled: direct backend traffic cannot supply its own forwarded client identity. JSON requests have a 64 KiB limit and a five-second absolute body deadline starting at header receipt, including time spent awaiting authentication. Rejected and unread-body responses close their connections. Header, request, idle, keepalive and total-connection bounds provide additional transport limits; they cannot provide network-level DDoS protection.

Run `pnpm exec vitest run elsewhere/server/test/admission.test.ts elsewhere/server/test/http-availability.test.ts elsewhere/server/test/http.test.ts elsewhere/server/test/visitors.test.ts` for isolated local overload, ownership, visitor lifecycle, slow-body and socket-recovery checks. Never run saturation checks against the public service.
