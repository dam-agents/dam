# ADR-074: Server-side per-user session read state

**Date:** 2026-07-09
**Status:** Proposed
**Owner:** @kapetr

## Context

The sessions list shows per-session status indicators, and the row design reserves a bold title for sessions with activity the user hasn't seen (#2427). Showing that requires remembering, per user, when each session was last viewed. Sessions themselves are deliberately agent-owned — the server has no session service, and the UI reads them over ACP — so read state has no obvious home. Client-local storage was considered and rejected: read/unread would not follow the user across devices.

## Decision

Per-user session read state is stored server-side in the platform database, keyed by user and session, holding the session's own activity timestamp at the moment it was seen. This is a deliberate exception to the no-session-state stance, drawn at a boundary: **the platform DB may hold per-user view-state *about* sessions (who has seen what); session content and lifecycle remain agent-owned and readable only over ACP.**

Rules of the decision:

- A session reads as unread when its activity timestamp is newer than the caller's stamp; stamps compare session timestamps to session timestamps, never to a client clock.
- Stamps are private to the user who wrote them; the API exposes only the caller's own state.
- The harness and agent pod know nothing about read state — there is no second owner, so the split-brain failure that motivated the no-session-state rule cannot occur here.

## Alternatives Considered

- **Client-local storage** — no cross-device consistency; a session read on desktop stays unread on the phone.
- **Agent-side, in session metadata** — preserves the rule literally (stamps ride `session/list`, die with the agent), but the pod has no user identity today: per-user stamps would need a new ACP write surface plus identity plumbing, and would make pod-resident (agent-forgeable, co-user-readable) data authoritative about users.
- **Derive from the activity ledger** — "prompted" is not "read" (viewing without prompting marks nothing), and it repurposes a usage/reporting ledger as UI state.
- **IdP user attributes** — the identity provider is not an application state store; no query shape, size limits.

## Consequences

- **Easier:** unread is consistent across devices and clients for the same user — the stamp is one DB row away for any surface (UI today; channels or CLI could reuse it).
- **Easier:** no new protocol or pod surface — the platform DB already holds session-referencing rows (pending approvals, activity events), and this follows the same shape.
- **Harder:** orphaned stamps — sessions and agents are not DB rows, so no foreign key can clean up after deletion; rows are tiny but agent-deletion cleanup needs a hook (precedent: skills cleanup) or the growth is accepted.
- **Harder:** a new steady write path — marking seen while a session is open writes up to one upsert per user per list-poll tick, where the api-server previously had no per-view writes.
- **Committed-to:** the view-state boundary. The next per-user preference will cite this ADR to justify a DB home; anything the harness owns (messages, titles, modes, lifecycle) stays agent-side regardless of this decision.
