---
id: 082
title: Prompt delivery is measured by the server, not inferred by the client
status: accepted
subsystem: agent-lifecycle
tags: [acp, sessions, prompt-queue, ui]
summary: The runtime tells the originating channel what happened to each identified prompt via two ephemeral notifications, and the client's delivery indicator is a state machine driven only by those frames.
---

# ADR-082: Prompt delivery is measured by the server, not inferred by the client

**Date:** 2026-08-03
**Status:** Accepted
**Owner:** @tomkis

## Context

The delivery indicator added in #133 infers "not delivered" from "no content arrived within 60 seconds of sending". Prompt queueing (ADR-026) made those two different facts: a prompt sent while the session's previous turn is still running is parked by the runtime and legitimately produces nothing for the sender until that turn ends. So the indicator fires on a prompt the agent received and answered (#829) — and, symmetrically, stays silent when the platform really did drop a queued prompt. An indicator that lies in both directions is worse than none.

## Decision

Delivery is measured by the server, not presumed by the client. The runtime reports the fate of each prompt to the channel that sent it, over the same extension mechanism as `platform/turnEnded`: **`platform/promptAccepted`**, carrying whether the prompt was queued behind a running turn, and **`platform/promptStarted`**, sent when the prompt is handed to the agent process. The client renders a state machine over those frames and holds no delivery logic of its own.

- **Sender-only and ephemeral.** Both notifications go to the originating channel, are never appended to the session log, and are never replayed. They are feedback about one client's send, not session history.
- **Correlation is opt-in.** A prompt is identified by a client-generated id carried in `session/prompt`'s platform `_meta` namespace, stripped before the frame reaches the agent. A prompt without an id gets no notifications and behaves exactly as it does today, so the CLI, channel workers, and older clients need no change.
- **Failure semantics are per-state.** Sending→accepted is bounded at 60s — the true delivery check, normally milliseconds. Queued is unbounded and fails only on an event: the sender's own connection closing, because the runtime drops a channel's queued prompts when that channel detaches, so connection loss means the prompt is gone. Agent exit and environment recycle close channels too, so that one rule covers every drop path. Started→first content is bounded at 60s — the wedged-agent check the original watchdog was reaching for, now anchored to the moment the agent actually has the prompt.
- **Failure offers Retry, never an auto-resend.** A retry is a fresh send. The client cannot distinguish "dropped while queued" from "promoted just before the socket died", so resending on its own would risk double delivery.
- **Terminology.** *Accepted* — the runtime has the prompt and has either queued it or handed it on. *Queued* — parked behind an in-flight turn; lossy. *Started* — handed to the agent. *Wedged* — agent alive but permanently silent.

## Alternatives Considered

- **Suppress the client watchdog for locally-queued bubbles** — reattaching wipes the local streaming state that marks a bubble as queued, so the reported repro (return to a backgrounded tab) stays broken; and it presumes delivery rather than measuring it.
- **Decide at send time from the client's own "is a turn running" view** — duplicates the runtime's queueing rules in the client and races its own polled state, so the answer is stale exactly when a turn is starting or ending.
- **Overload the logged user-prompt echo's queued flag as the acknowledgement** — that echo is history: replayed to every viewer, and reconciled against the sender's optimistic bubble by a tail fold that has nothing to match against after a reattach.

## Consequences

- **Easier:** the false failure in #829 becomes structurally impossible — nothing fails without a server frame or a closed socket saying so — and the genuine drop it hid (a queued prompt lost to detach, agent exit, or environment recycle) now surfaces with a Retry, which no client-side timer could have detected at all.
- **Harder:** delivery feedback becomes a versioned protocol surface. The runtime and the UI must agree on two frames and an id-carrying `_meta` key, and the queued state's only failure edge is a socket close — so any future path that discards a queued prompt while the sender stays connected leaves the indicator waiting forever unless it also emits a frame.
- **Accepted:** a wedged prior turn (agent alive, emitting nothing, never finishing) leaves the prompt queued behind it waiting indefinitely, showing a truthful "waiting" state. This is a real hole, and closing it needs a server-side liveness answer rather than another client timer, so it is deferred to its own issue.
- **Committed-to:** the runtime owns the delivery verdict. Any future client — the CLI, a second UI, a channel adapter — earns honest feedback by adopting these frames, and none may reintroduce a local timer that decides delivery on its own.
