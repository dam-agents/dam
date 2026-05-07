# ADR: Durable user-prompt submission

**Date:** 2026-05-07
**Status:** Proposed
**Owner:** @janjeliga

## Context

ADR-007 established that all ACP traffic flows UI → API Server → agent pod over WebSocket. In practice this also carried user prompt sends, coupling prompt delivery to the lifetime of the UI's WebSocket. A tab close, network blip, or reload between submit and the agent receiving the prompt loses the message.

## Decision

The DAM UI submits user prompts to the API Server through a server-mediated submission path (separate from the live ACP WebSocket). The API Server is responsible for delivering each accepted prompt to the agent, so a UI tab close, network blip, or reload between submit and the agent receiving the prompt no longer loses the message.

A prompt identifier travels with each submitted prompt and with the agent's later echo of it, so the same prompt can be reconciled across UI views without duplication.

This adds a path; it does not remove one. ACP `session/prompt` continues to work for any caller speaking it directly, with the original semantics — live, no durability, no idempotency. Today the DAM UI is the only consumer of the durable path; external integrators that prefer plain ACP keep their existing surface.

### Relation to ADR-007

The API Server → agent pod leg is unchanged. Streaming, notifications, approvals, and direct ACP `session/prompt` from any non-DAM-UI caller all continue to flow as before. ADR-007 is narrowed only in that the DAM UI uses a new submission path for its own prompts — the surface external ACP callers see is unchanged.

## Alternatives Considered

**Keep prompts on the live WebSocket and rely on the UI to retry.** Rejected: makes prompt durability a UI concern, can't survive a closed tab, and gives no cross-tab/cross-device guarantee that a submitted prompt reaches the agent exactly once.

**Expose the durable path as an ACP-extension method (e.g. `platform/sendPrompt`) instead of via a separate transport.** Deferred, not rejected. Same durable behavior, exposed so external ACP-only clients would have one transport for everything. Reasons we did not pick it now: the API Server already has tRPC wired with typed schemas, auth, and validation, so reusing it cost nothing extra; vanilla `session/prompt` can't carry durable semantics directly (its JSON-RPC response is the agent's stop reason, which doesn't exist at enqueue time, so the durable variant has to be a distinct method anyway). The internal architecture (outbox, forwarder, wrapper-side dedup) is caller-agnostic — adding a `platform/sendPrompt` ACP method that hands off to the same service is straightforward when external ACP-only callers become a real use case.

## Consequences

- A prompt accepted by any API Server replica is durably owned by the API Server tier — not pinned to that replica — until the agent receives it. The accepting replica can fail immediately after acknowledging the submission and the prompt still reaches the agent.
- The agent's reply path is unchanged from ADR-026 (replica-agnostic per-session log with cursor fan-out), so the replica that serves the reply need not be the replica that accepted the prompt.
- The same prompt observed in multiple UI sessions reconciles via the prompt identifier instead of producing duplicates.
- Submission is no longer constrained by the liveness of any single UI WebSocket or any single API Server replica.
- The API Server tier takes on responsibility for prompt delivery and its failure modes.
- Two entry surfaces coexist for prompt submission: durable (DAM UI today, via the new path) and standard ACP (external callers, via `session/prompt` over the live WebSocket). The wrapper processes both identically once they reach it; durability is an opt-in property of the entry path, not a constraint on the agent or the wrapper. External callers do not need to change to keep working — they simply do not benefit from the durability feature unless they migrate.
