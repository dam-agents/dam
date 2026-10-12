# 03 — Steer a mid-turn message

**Depends on:** 01-shared-queue
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

Claude Code users expect a message sent while the agent works to reach the agent in that turn,
next to the next tool result, not after the turn ends. The Claude Code adapter supports this as
the ACP extension `_session/steering`. This slice makes the runtime steer a web UI prompt into the
running turn when the harness supports it, and queue it otherwise. Attachments (inline images,
resources) steer too: a steer uses the same prompt conversion as `session/prompt`.

## Implementation plan

Apply `/typescript-engineering` (runtime, contract) and `/react-ui-engineering` (UI).

1. **Capability** — `acp-runtime.ts`: read `initialize` result `_meta.steering.supported === true`
   next to the existing `close`/`resume` capability reads; keep it per harness process. Reuse
   `STEER_METHOD` and the response schema from `packages/api-server/src/core/acp-client.ts` by
   moving them into `api-server-api` (`types.ts`) so the runtime and the api-server share one
   definition.
2. **Scheduler** — `prompt-scheduler.ts` `submit`: when a turn is in flight, the session's queue is
   **empty**, the submission is steerable (`surface === "ui"` in this slice) and the harness
   steers, call a new dep `steer(submission): Promise<"injected" | "refused">` instead of queueing.
   - Claim before sending: while a steer is in flight, later submissions for the session queue
     behind it (order rule).
   - `injected` → `onSteered(submission)`, always: the harness checks for and joins the running
     turn in one step, so an injected prompt is delivered even if the runtime already saw the
     turn end (its sender is then answered at once). `promptRequired` or a failed steer → put the
     submission back at the **head** of the queue and run the normal queued path. The queue
     holds while a steer is out. No deadline on the steer reply: giving up could deliver twice.
   - After an injection, and when a queued prompt starts a turn, the queue's head is steered into
     the running turn if it is steerable — one at a time, so the queue drains in order (operator
     decision). A refused head stays queued for the next turn.
   - The steer request uses `_meta.steering.idleBehavior = "promptRequired"`, so an idle harness
     answers `promptRequired` and never starts a turn on its own.
3. **Runtime** — on `onSteered`: write the user echo with `_meta.steered: true` (same
   `appendUserPromptToLog`, at the moment of injection), notify the sender
   `platform/promptAccepted{ steered: true }`, and answer the original `session/prompt` request when
   the running turn ends, with that turn's stop reason (map the steered `outboundId` to the active
   turn in `outboundIdToClient`).
4. **UI** — `session-projection.ts` / `prompt-delivery.ts`: a `steered` acceptance marks the user
   bubble sent (no queued indicator); the reply so far ends above it and the turn's output
   continues in a reply bubble below it — the shape other viewers and a replay give it. A steered echo from another tab renders as a user bubble where it was
   injected. `chat-input.tsx`: while a turn runs, the button and placeholder say "Send" when the
   harness steers and "Queue" when it does not — expose the capability to the UI through the
   existing session load meta (`_meta.platform.steering: boolean`).
5. **Docs** — `agent-lifecycle.md` "Prompt delivery": the fourth fate, **steered**, and the order
   rule; `platform-topology.md` if the frame contract table names the queued echo.

## Acceptance criteria

- [ ] On Claude Code, a message sent mid-turn is answered within the same turn; no second turn
      starts for it.
- [ ] A message with an image sent mid-turn is steered and the agent sees the image.
- [ ] A message sent while an earlier one is still queued queues behind it (no reorder), and
      queued messages are steered into a running turn one by one, in order.
- [ ] If the turn ends during the steer round trip, the message starts as the next turn, once.
- [ ] A scheduled fire or invocation outcome arriving mid-turn still queues.
- [ ] On Codex/Bob the composer says "Queue" and messages queue as in 01.
- [ ] Package tests pass (agent-runtime, ui, api-server-api, api-server).

## Smoke test

On a Claude Code agent: send "list every file under /etc one tool call at a time, slowly". Mid-run
send "stop at 5 files and summarize". The message shows as sent at once, the agent reacts within
the same turn, and the session shows one assistant reply. Reload: the steered message sits inside
that turn. Repeat with a pasted screenshot: the agent describes it.

## Follow-up after review (operator)

- A steer waits until the turn has no open tool call (tracked from the agent's own tool-call
  frames), at most 60 s; meanwhile the prompt is an ordinary queued one, editable and removable.
  After 60 s it is steered regardless. This keeps the agent from being cut off mid-tool, which
  the Claude Code adapter's immediate delivery does.
- Stop is the way to cut in at once; Esc in the message box stops too.
