# ADR: Durable user-prompt submission

**Date:** 2026-05-07
**Status:** Proposed
**Owner:** @janjeliga

## Context

ADR-007 established that all ACP traffic flows UI → API Server → agent pod over WebSocket. In practice this also carried user prompt sends, coupling prompt delivery to the lifetime of the UI's WebSocket. A tab close, network blip, or reload between submit and the agent receiving the prompt loses the message.

## Decision

User-prompt submission is decoupled from the UI's live ACP WebSocket. The UI submits prompts to the API Server through a separate server-mediated channel; the API Server is responsible for delivering them to the agent.

A prompt identifier travels with each submitted prompt and with the agent's later echo of it, so the same prompt can be reconciled across UI views without duplication.

### Relation to ADR-007

Narrows ADR-007 for the prompt-send leg only. The API Server → agent pod leg is unchanged. Streaming, notifications, and approvals continue to flow over the live UI WebSocket. ADR-007 remains in effect for everything except the UI → API Server submission of user prompts.

## Alternatives Considered

**Keep prompts on the live WebSocket and rely on the UI to retry.** Rejected: makes prompt durability a UI concern, can't survive a closed tab, and gives no cross-tab/cross-device guarantee that a submitted prompt reaches the agent exactly once.

## Consequences

- A prompt accepted by any API Server replica is durably owned by the API Server tier — not pinned to that replica — until the agent receives it. The accepting replica can fail immediately after acknowledging the submission and the prompt still reaches the agent.
- The agent's reply path is unchanged from ADR-026 (replica-agnostic per-session log with cursor fan-out), so the replica that serves the reply need not be the replica that accepted the prompt.
- The same prompt observed in multiple UI sessions reconciles via the prompt identifier instead of producing duplicates.
- Submission is no longer constrained by the liveness of any single UI WebSocket or any single API Server replica.
- The API Server tier takes on responsibility for prompt delivery and its failure modes.
