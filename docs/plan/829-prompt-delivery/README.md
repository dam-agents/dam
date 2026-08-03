# Honest prompt delivery feedback

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/829

## Goal

Kill the false "Couldn't deliver" error that appears when a prompt is sent into a session
whose previous turn is still running (the #829 repro: return to a backgrounded tab or a
session with scheduled background work, send a prompt, prior turn runs longer than 60s).
The delivery indicator introduced in #133 must never lie: it fails only when the prompt
genuinely didn't reach the agent, and it *does* fail when the platform really dropped the
prompt — a case that is silent today.

## Approach

The current watchdog (`packages/ui/src/modules/sessions/hooks/use-acp-prompt.ts`) infers
"not delivered" from "no content within 60s of send". Prompt queueing makes those two
different things: a prompt sent mid-turn is parked by the runtime
(`packages/agent-runtime/src/modules/acp/services/acp-runtime.ts`, `promptQueueBySession`)
and legitimately produces zero frames for the sender until the prior turn ends.

The fix makes the server authoritative about prompt delivery. The runtime tells the sender
what happened to each prompt via two new ephemeral notifications (same extension mechanism
as the existing `platform/turnEnded`); the client becomes a dumb state machine driven only
by server frames. No delivery business logic is duplicated client-side.

Architecture context: [`docs/architecture/agent-lifecycle.md`](../../architecture/agent-lifecycle.md)
(sessions and the ACP relay).

### Pinned notification contract

Both frames follow the `platform/turnEnded` pattern: Zod schema + builder in
`packages/api-server-api/src/modules/acp/types.ts`, emitted by agent-runtime, validated in
the UI's extNotification handler.

```
platform/promptAccepted   params: { sessionId: string, promptId: string, queued: boolean }
platform/promptStarted    params: { sessionId: string, promptId: string }
```

- **Sender-only and ephemeral**: sent to the originating channel via `sendToChannel`, never
  appended to the session log, never replayed.
- `promptId` is a client-generated UUID carried in `session/prompt`
  `params._meta.platform.promptId` (the SDK's `PromptRequest` supports `_meta` natively).
  The runtime strips the `platform` key before forwarding to the agent — same
  `extractPlatformMeta`/`stripPlatformMeta` pattern used for `session/new`.
- A prompt without a `promptId` (CLI, channel workers, older clients) gets **no**
  notifications; behavior for those senders is unchanged.
- On queue-full rejection no `promptAccepted` is emitted — the error response already
  covers that path.

### Client state machine

```
sending ──accepted{queued:false}──▶ (direct)  ──started──▶ active ──content/turn end──▶ done
sending ──accepted{queued:true}───▶ queued    ──started──▶ active
   │                                   │                      │
   └─ no accepted in 60s → failed      └─ own WS closes       └─ no content in 60s
                                          → failed (Retry)       after started → failed
```

- **sending → accepted**: 60s timer. True delivery check; normally milliseconds.
- **queued**: no timer, unbounded. Fails only when the sender's own WS closes — the runtime
  drops a channel's queued prompts on detach (`acp-runtime.ts` `detach()`), so connection
  loss means the prompt is gone. Agent exit and env recycle close channels too (code 1011),
  so one rule covers all three drop paths.
- **started → first content**: 60s timer, the wedged-agent check — the original watchdog's
  job, now anchored at the right clock.
- Failure always offers Retry (a fresh send, never an auto-resend — avoids double delivery).

### Decisions (recorded as an ADR in sub-issue 01)

1. Delivery is measured by the server, not presumed by the client.
2. Dedicated ephemeral notifications; the logged `_meta.queued` user-chunk echo is not
   overloaded as an ack.
3. WS drop while queued → fail with Retry; no auto-resend.
4. Queued state is unbounded; wedged-agent detection is explicitly out of scope (follow-up
   issue to be filed separately, outside this plan).
5. Both timers stay at 60s; tightening the ack timer is a possible follow-up.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ADR: server-authoritative prompt delivery | Record the decision cluster via the `/adr` skill | — |
| 02 | Runtime: prompt lifecycle notifications | Schemas/builders in api-server-api; emit accepted/started from agent-runtime | 01 |
| 03 | UI: delivery state machine | promptId stamping, notification mapping, watchdog → per-state timers | 02 |
| 04 | UI: fail queued prompts on disconnect + doc update | WS-close rule, failure state surviving reconnect; agent-lifecycle.md section | 03 |
| 05 | E2E: delivery feedback specs | Four Playwright specs in `tests/full/` driving the scripted mock agent | 04 |

## Conventions & glossary

- **Accepted** — the runtime received the prompt frame and either queued it or handed it on.
- **Queued** — parked in `promptQueueBySession` behind an in-flight turn. Lossy: dropped on
  sender detach, env recycle, agent exit.
- **Started** — handed to the agent process (`forwardPromptToAgent`); the moment delivery is real.
- **Wedged** — agent alive but permanently stuck; emits nothing, indistinguishable from slow.
  Out of scope here.
- Apply `/typescript-engineering` for `packages/agent-runtime` and `packages/api-server-api`;
  apply `/react-ui-engineering` for `packages/ui`.
- ADRs are authored with the `/adr` skill and are never referenced from code or docs.
- New tests are not authored except where flagged (sub-issue 02 — runtime frames have no
  manual smoke path without the UI slices — and sub-issue 05, whose deliverable *is* the
  e2e regression suite for this feature).

## Whole-feature smoke test

Automated: sub-issue 05's specs cover the four scenarios below end to end
(`mise run e2e:loop --full` against the warm test cluster).

For a by-hand check on a running local cluster (use the `cluster-ops` skill):

1. Open a session, start a long turn: "run `sleep 90` and then reply done".
2. While it runs, send a second prompt. Expect "Waiting for previous prompt…" within a
   second, **no failure at the 60s mark**, and both turns completing in order.
3. Reload the tab mid-turn, send a prompt (the #829 repro). Same expectations.
4. With a prompt queued behind a running turn, kill the agent pod. Expect the queued bubble
   to flip to "Couldn't deliver" with a working Retry button — including after the tab
   reconnects.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/829.
