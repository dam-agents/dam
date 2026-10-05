# 01 — The queue is shared and truthful

**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

The scheduler already queues prompts, but only the sending tab hears about them, the queued echo
goes into the transcript before the prompt runs, and the UI ends queued bubbles on Stop or on a
socket drop while the runtime still holds them. This slice makes the runtime the visible source of
truth for the queue, so every tab and every reload shows the same queued messages, and they stay
queued until they really start. It fixes "messages fail instead of queueing" and the #3264 class.

## Implementation plan

Apply `/typescript-engineering` (runtime, contract) and `/react-ui-engineering` (UI).

1. **Contract** — `packages/api-server-api/src/modules/acp/types.ts`: add `queuedPromptSchema`
   (`QueuedPrompt` from the README), `platformQueueChangedParamsSchema` +
   `buildPlatformQueueChangedNotification`, and `platformQueueMetaSchema` for
   `session/load` `_meta.platform.queue`. Export from the package index.
2. **Scheduler** — `prompt-scheduler.ts`:
   - Keep each submission's prompt blocks and `queuedAt` (add `prompt: PromptBlock[]`,
     `queuedAt`, `surface` to `PromptSubmission`; the runtime fills them from the frame).
   - Add `snapshot(sessionId): QueuedPrompt[]` and a dep `onQueueChanged(sessionId)` fired on every
     queue mutation: push, start (shift), refuse, drop, forget, clear, refuseQueue.
3. **Runtime** — `acp-runtime.ts`:
   - `onQueueChanged` → broadcast `platform/queueChanged` to every engaged channel of the session
     (`engagedViewersOf` pattern used by `platform/runStarted`). Not logged, not replayed.
   - `session/load` result: add `_meta.platform.queue = scheduler.snapshot(sessionId)` next to
     `undelivered`.
   - Move the user echo from submit to **start**: call `appendUserPromptToLog` from the scheduler's
     `onTurnStarted` (it has the submission: prompt, channel, promptId) instead of in the
     `session/prompt` branch. Drop the `queued` parameter and `_meta.queued` write.
   - The undelivered path is unchanged: dropped prompts never got an echo now, so check
     `supersedeEcho` / `dropSuperseded` still behave (a retired record whose echo was never written
     is a no-op).
4. **UI projection** — `packages/ui/src/modules/acp/session-projection.ts`:
   - Hold the queue as session state from `platform/queueChanged` and the load snapshot. Render each
     item as a user bubble in the queued state, after the transcript, in queue order (inline, as
     today's queued bubble). Remove `appendQueuedUser` and the `_meta.queued` handling; old pods
     that still send `_meta.queued` echoes render them as ordinary user bubbles.
   - When an item leaves the queue and its echo arrives, the transcript bubble replaces it (match by
     `promptId` = echo `messageId`).
   - The sender's optimistic bubble (`use-acp-prompt.ts`) reconciles with the queue item by
     `promptId`, so the sender sees one bubble, not two.
5. **UI lifecycle** — `failQueuedOnDisconnect` must not fail queued items; on reconnect the load
   snapshot is the truth. `stopAgent` / `finalizeAllStreaming` must finalize only the running
   assistant bubble, never queued items. `prompt-delivery.ts`: a queued prompt is never failed for
   waiting (already the rule) — check the 60 s ack timer still only covers "accepted".
6. **Copy** — keep "Waiting for previous prompt…" on queued bubbles; the composer still says
   "Queue" in this slice (03 changes it).
7. **Docs** — `docs/architecture/agent-lifecycle.md` "Prompt delivery": the queue is broadcast and
   returned on load; the echo is written when the prompt starts.

## Acceptance criteria

- [ ] Two tabs on one session show the same queued bubbles, in order, without a reload.
- [ ] A reload mid-queue shows each queued prompt as its own queued bubble (no merge).
- [ ] Stop ends the running turn; queued bubbles stay queued and the next one starts.
- [ ] Killing the socket (offline toggle) does not mark queued bubbles failed; after reconnect they
      are still queued or already started.
- [ ] A queued prompt appears in the transcript exactly once, when it starts.
- [ ] `mise run //packages/agent-runtime:test`, `//packages/ui:test`, `//packages/api-server-api:test` pass.

## Smoke test

Use an agent whose harness does not steer (Codex or Bob) so the queue stays visible.

1. `mise run cluster:build -- agents api-server` (runtime ships in the agent images); UI on the
   Vite dev server.
2. Open the same session in two tabs. In tab A send "count slowly to 30, one number per tool call",
   then send "first" and "second".
3. Tab B shows both queued bubbles. Reload tab B: still two separate queued bubbles.
4. Press Stop in tab A: the turn ends, "first" starts, "second" stays queued in both tabs.
