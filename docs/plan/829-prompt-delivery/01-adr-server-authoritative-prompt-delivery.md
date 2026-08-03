# 01 — ADR: server-authoritative prompt delivery

**Part of:** Honest prompt delivery feedback — see [README](./README.md)

## Context

The grilling session on #829 produced a decision cluster that reshapes how prompt delivery
feedback works (protocol extension + client failure semantics). Per project convention the
decisions are recorded as an ADR before implementation starts, while the rationale is fresh.

## Implementation plan

1. Invoke the `/adr` skill and author one ADR covering the full decision cluster:
   - **Decision**: prompt delivery is measured by the server, not inferred by the client.
     The runtime emits `platform/promptAccepted { sessionId, promptId, queued }` and
     `platform/promptStarted { sessionId, promptId }` to the originating channel only,
     ephemeral (never logged/replayed). `promptId` travels in `session/prompt`
     `params._meta.platform.promptId`.
   - **Rejected alternatives**, with the reasons found during grilling:
     - Client-side suppression of the watchdog for locally-queued bubbles (local state is
       wiped on reattach — `finalizeAllStreaming` after `loadHistory` — so the reported
       repro would stay broken; and it presumes delivery instead of measuring it).
     - `running || hasStreamingAssistant` heuristic at send time (duplicates delivery
       business logic client-side, stale-poll races).
     - Overloading the logged `_meta.queued` user-chunk echo as the ack (it is history —
       replayed to everyone — and its tail-fold reconciliation breaks in the reattach case).
   - **Failure semantics**: per-state contract — 60s timer sending→accepted; queued is
     unbounded with event-driven failure on the sender's WS close (the runtime drops a
     channel's queued prompts on detach, so connection loss means the prompt is gone);
     60s timer started→first content. Failure always offers Retry as a fresh send; no
     auto-resend (double-delivery risk: the client cannot distinguish "dropped while
     queued" from "promoted just before the socket died").
   - **Accepted consequence**: a wedged prior turn (agent alive, silent, never finishing)
     leaves a queued prompt waiting indefinitely with a truthful "waiting" indicator.
     Wedged-agent detection is deferred — it needs a server-side answer and its own issue.
   - **Terminology**: Accepted / Queued / Started / Wedged as defined in the README's
     glossary section.
2. Follow the ADR conventions the skill enforces (numbering, status, format). Do not
   reference the ADR from any code or documentation.

## Acceptance criteria

- [ ] One new ADR exists under `docs/adrs/` following the existing naming/numbering scheme.
- [ ] It records the decision, the three rejected alternatives with reasons, the failure
      semantics, and the deferred wedge-detection consequence.
- [ ] No code or doc file references the ADR.

## Smoke test

`git diff --stat main` shows only the new ADR file (plus this plan folder); the ADR renders
cleanly as Markdown and its header matches the format of the most recent existing ADR in
`docs/adrs/`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
