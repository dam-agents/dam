# ADR-074: Session read state in agent-owned session metadata

**Date:** 2026-07-09
**Status:** Proposed
**Owner:** @kapetr

## Context

The sessions list reserves a bold title for sessions with activity the user hasn't seen (#2427), which requires remembering when each session was last viewed. Sessions are deliberately agent-owned — a duplicate server-side session table was removed in a painstaking refactor, and the server has kept no session state since. Read state needs a home that doesn't reintroduce that duplication.

## Decision

Read state is a per-session `seenAt` stamp in the agent-owned session metadata, written by the agent runtime whenever session activity happens while a viewer is attached, and surfaced to clients over the existing `session/list` metadata enrichment. A session reads as unread when its activity timestamp is newer than `seenAt`; activity with no viewer attached (scheduled runs, background terminal work, channel messages) is what produces unread.

Rules of the decision:

- Read state is **per-session, not per-user**. Agents currently have a single driving user; if shared agents become real, this decision is revisited rather than stretched.
- The stamp is written agent-side by the runtime from viewer engagement it already observes — clients never write read state, and no user identity enters the pod.
- Timestamps compare session activity to session activity; no client clock is involved.

## Alternatives Considered

- **Platform DB table (per-user stamps)** — reintroduces server-held session state that was deliberately refactored away, and builds per-user machinery for a multi-user situation that doesn't exist yet; also leaves orphan rows (sessions and agents are not DB rows, so no FK cleanup).
- **Client-local storage** — no cross-device consistency; a session read on desktop stays unread on the phone.
- **Derive from the activity ledger** — "prompted" is not "read" (viewing without prompting marks nothing), and it repurposes a usage/reporting ledger as UI state.

## Consequences

- **Easier:** no new API, table, or protocol surface — the stamp rides the same `session/list` enrichment that already carries mode and live turn status, so every client gets cross-device-consistent unread for free.
- **Easier:** correct marking without polling races — the runtime knows synchronously whether a viewer was attached when activity happened; a client-written stamp would trail the 5 s list poll.
- **Easier:** lifecycle is free — the stamp lives with the session's metadata on the agent's volume and disappears with the session or agent; no cleanup path.
- **Harder:** any viewer marks the session read for everyone — with shared agents (allowed users, multiple channel identities) one person's glance would clear another's unread; acceptable only while agents are single-driver, which is the recorded assumption.
- **Harder:** channel sessions are approximate — a channel worker's transient attachment during message relay counts as viewing, so "unread" for Slack/Telegram sessions means "no client attached", not "the human read it".
- **Committed-to:** the single-driver assumption, now load-bearing for read semantics — shared-agent work must revisit this ADR first.
