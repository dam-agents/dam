# 03 — The runtime cuts in place and resets the Session

**Depends on:** 01-reset-adr, 02-image-cut-provider
**Part of:** A rewind keeps the session — see [README](./README.md)

## Context

`platform/rewriteFrom` forks today for every cut.
With a session-cut provider declared for the Session's harness, a rewind (`mode: "rewind"`) and a take-back (no `prompt`) cut in place and reset the Session under the same id.
Fork mode, a cut before the first message (`{kind: "start"}`), and harnesses without the provider keep the fork.

## Implementation plan

All in `packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts` unless noted.

1. **Contract** — `packages/api-server-api/src/modules/acp/types.ts`: add `platformSessionResetParamsSchema = z.object({ sessionId: z.string() })`, its notification schema and `buildPlatformSessionResetNotification(sessionId)`, next to `platformQueueChanged*` (~270–295); export them from `packages/api-server-api/src/index.ts`.
2. **The cut point** — `packages/agent-runtime/src/modules/acp/domain/rewrite-cut.ts`.
   Today `rewriteCutOf` and `takeBackCutOf` return `{kind: "after", entry}` (the entry **above** the target batch, which may be an API `msg_` id).
   The in-place cut needs the **target batch's first user entry**: add it as `{ kind: "after"; entry: string; batch: string }`, where `batch` is `_meta.platform.entry` of the batch's first user frame (`frames[target.first]`; equal to its `update.messageId`, the user entry's uuid).
   The fork path keeps using `entry`.
   This is the one place a new unit test is worth it: extend `packages/agent-runtime/src/__tests__/unit/rewrite-cut.test.ts` with `batch` for a single and a multi-message batch, since the index arithmetic has no manual path.
3. **The decision** in `rewriteFrom` (~1157): after `rewriteCutFor`, when `cut.kind === "after"`, `params.mode === "rewind"` and `deps.sessionCut` is set, call `cutInPlace(channel, id, params, cut)` instead of `forkForRewrite`.
   The `sessionForkSupported` refusal applies only to the fork path.
   `absent`, `missing` and `start` keep their current handling.
4. **`cutInPlace`** (new, beside `forkForRewrite`):
   1. Capture `viewers = engagedViewersOf(sid)` (~972).
   2. Close the harness's live copy: send `session/close` when the session is not cold (as `tearDownSession` does, ~1481), and wait for its response before cutting, so the adapter's `claude` process does not hold or rewrite the uncut chain.
      If `session/close` is not supported, refuse with `REWRITE_REFUSED_CODE` ("this agent cannot rewrite a conversation").
   3. `await deps.sessionCut.cut({ sessionId: sid, before: cut.batch, ...(params.prompt === undefined && { dropsTurn: cut.batch }) })`.
      - `refused: true` → `failRewrite(message, REWRITE_REFUSED_CODE)`; nothing else changes (the session is merely cold).
      - `ok: false, refused: false`, a throw or a timeout → reset anyway (step 4, so the log matches whatever the store now holds), then `failRewrite(message)` with no code, which the UI shows as an error (decision 3).
   4. **Reset**, keeping id and metadata: clear what `tearDownSession` clears for the log and the harness copy — `transcript.forget(sid)`, `openToolCalls`, `generating`, `runTextBuffers`, `supersededEchoes`, `appliedSettings`, `rehydratingSessions` and rehydrate timers — and add `sid` to `harnessColdSessions`.
      Do **not** call `retireSession`, `sessionMetadata.adopt/set` (except `customTitle` when `params.title` is set), or `promptScheduler.forget` (the busy refusal guarantees the queue is empty).
      Extract the shared clearing out of `tearDownSession` into one function both use, instead of copying the list.
   5. `bootstrap.fill(sid, done)`: the log is filled again from the history provider (the cut history).
      Keep the original times as the fork path does (`withOriginalTimes`) only if the refill changes them; the history provider returns the stored times, so it should not be needed — check.
   6. On fill: `rewritingSessions.delete(sid)`; send `buildPlatformSessionResetNotification(sid)` to `viewers` (ephemeral, like `announceQueue` ~1398, not `transcript.append`); reply `{ sessionId: sid }`; if `params.prompt` is set, `submitRewrittenPrompt(channel, sid, params.prompt, params.promptId)`, which rehydrates the cold Session through `session/resume`.
      The reset goes out **before** the reply and the prompt, so a viewer's reload never races the new prompt's echo (slice 04 relies on this order).
5. **Spend and telemetry** need no change: they are keyed by the Session id on the api-server.
6. **Capability to the UI**: the UI gates rewind on `harnessForks` (fork capability).
   A Claude Code agent advertises fork too, so no new UI gate is needed for it; leave the gate as is.
7. Docs: none beyond slice 01.

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] A take-back on an unanswered prompt with a `sessionCut` provider answers `{ sessionId: <same id> }`, and a load afterwards returns the history without the dropped batch.
- [ ] A rewind with a prompt answers with the same id, the edited prompt runs, and the reply goes to the same Session.
- [ ] Engaged viewers get exactly one `platform/sessionReset` before the reply; the log holds no such frame.
- [ ] The guard's refusal answers `REWRITE_REFUSED_CODE` and leaves the history unchanged.
- [ ] Fork mode, a `start` cut, and a runtime without `sessionCut` behave as before (the existing `acp-runtime-rewrite.test.ts` passes unchanged).
- [ ] `mise run //packages/agent-runtime:check`, `:check:format`, `:check:lint`, `:test` and `//packages/api-server-api:check` pass.

## Smoke test

`mise run //packages/agent-runtime:test` (covers `acp-runtime-rewrite.test.ts`, `rewrite-cut.test.ts`, the history-provider tests).

On the local cluster, with the agent image and agent-runtime rebuilt from this branch (`cluster-ops` skill), on a Claude Code agent:

1. Have two turns in a chat; note its id in the URL.
2. Send a third prompt and press Escape at once.
   The pod's agent-runtime log shows the cut and no `session/fork`; the URL keeps the id; reloading the page shows two turns.
3. Rewind to the second message with edited text: same id; the reply answers the edited text.
4. Settings › Usage, or the session list: the session's spend includes the first turn's cost.
