# 07 — Session frames out of the pod

**Part of:** Delegation visibility — see [README](./README.md)

## Context

Capturing a child's conversation needs a way to read a session's frames out of a live pod
from the api-server. None exists: the runtime's tRPC `sessions` router lists metadata only,
and the sole transcript path is the ACP WebSocket with `session/load`, which is a chat
protocol dance, not a read. This slice adds a plain runtime procedure that returns a
session's `session/update` frames, and the api-server client that calls it. It is
independent of the record and can land early.

Apply `/typescript-engineering`.

## Implementation plan

1. **Runtime contract** — `packages/agent-runtime-api/src/modules/sessions/router.ts`:
   add `history: protectedProcedure.input({ sessionId }).query(...)` returning
   `{ frames: string[]; truncated: boolean }`. Frames are the exact strings
   `validateLines` accepts (`packages/agent-runtime/src/modules/acp/infrastructure/history-provider.ts:14`).
2. **Runtime service** — `packages/agent-runtime/src/modules/acp/services/sessions-service.ts`
   gains `history(sessionId)`. Order of sources: the in-memory transcript log if the
   session is loaded (`session-transcript.ts` entries serialised back to frames, `truncated`
   from `log.truncated`), else `historyProvider.fetch(sessionId)`. When neither yields
   lines (a harness with no provider and the session not loaded) return an empty list, not
   an error: the caller treats empty as "nothing to capture". Cap the response at the
   existing 32 MiB provider cap.
3. **Pick the child's session.** The target runs one trigger session whose `scheduleId` is
   `invocation:<agentId>` (`trigger-session-driver.ts`). Add `sessions.list` filtering on
   the client side by that `scheduleId` rather than a new runtime input.
4. **api-server client** — `packages/api-server/src/modules/invocations/infrastructure/pod-session-client.ts`,
   modelled on `modules/kb-shares/infrastructure/agent-files-client.ts` (`httpBatchLink` to
   `http://<pod>/api/trpc` via `podBaseUrl`): `readInvocationFrames(agentId)` does
   `sessions.list`, picks the session with `scheduleId === "invocation:<agentId>"` (newest if
   several), then `sessions.history`. Hard timeout 15 s; any failure returns `null`. No
   `ensureReady`: a child that is hibernated has nothing worth waking for.
5. Expose it as a port on the invocations module: `TargetFramesReader { read(agentId):
   Promise<{frames, truncated} | null> }` in `services/`, adapter in `infrastructure/`.

## Acceptance criteria

- [x] `sessions.history` on a running pod returns the same frames the UI receives on
      `session/load` for that session. Verified 2026-09-24 against the driver pod after a
      restart, so the frames came from the harness's own provider rather than from memory:
      nine frames, the prompt, the reply and the three tool calls the chat shows.
- [x] For a harness without a history provider and an unloaded session it returns an empty
      list. Code path only; no such harness runs on the dev cluster.
- [x] A live child's session is found by its schedule id and its frames read back. Verified
      2026-09-24 from inside two child pods: one session each, `scheduleId`
      `invocation:<agentId>`, frames opening with the invocation's own prompt. The deleted
      case is the same call with nothing listening, which the client turns into `null`.
- [x] `mise run check` and `mise run test` pass.

## Smoke test

`mise run test` and `mise run check`. On the dev cluster, port-forward a running Agent's pod
service (cluster-ops skill) and call `sessions.history` over `/api/trpc` with a session id
from `sessions.list`; compare the frame count with what the UI shows for that session.
