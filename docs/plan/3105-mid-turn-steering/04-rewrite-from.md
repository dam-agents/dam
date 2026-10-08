# 04 — Rewind or fork from an earlier message

**Depends on:** 01-shared-queue
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

A user corrects context instead of patching it with follow-ups: edit a past user message, and the
conversation reruns from there, discarding everything after it. The harness cannot truncate a
session in place, but the Claude Code adapter can fork one up to a given assistant message
(`unstable_forkSession`, advertised as `sessionCapabilities.fork`). So a rewrite forks up to the
reply before the edited message, gives the fork the old session's identity in the list, deletes
the old session, and sends the edited text. Files the agent changed stay changed; the UI says
nothing about it (decision). Web UI only, idle sessions only, harnesses with fork only.

## Implementation plan

Apply `/typescript-engineering` (runtime, contract) and `/react-ui-engineering` (UI).

1. **Capability** — `acp-runtime.ts`: extend the session-capability reader (`"close" | "resume"`)
   with `"fork"`; expose it to the UI in the load meta (`_meta.platform.rewrite: boolean`), false
   for non-Regular-Chat sessions (scheduled, channel-bound with `threadTs`, initialization,
   machine sessions) because other parts of the platform hold their session id.
2. **Assistant message ids in the UI** — `session-projection.ts`: keep the ACP `messageId` of
   `agent_message_chunk` frames on the assistant bubble (live and replayed; Claude Code sets it).
   The fork point for editing user message *N* is the `messageId` of the **last** assistant
   message before it; editing the first user message has no fork point (`null`).
3. **Contract** — `types.ts`: `platformRewriteFromParamsSchema` / result per the README.
4. **Runtime** — `platform/rewriteFrom` handler:
   - Refuse unless idle: no turn in flight, empty queue, no pending permission request.
   - `upToMessageId === null` → a plain `session/new` with the same cwd; otherwise send
     `session/fork` (the adapter's `unstable_forkSession` method name — check the exact method
     string the SDK routes) with `_meta.jetbrains.air.fork = { version: 1, messageId }`.
   - Move identity: `sessionMetadata.set(newId, oldMeta.meta)` keeping `createdAt`; then the same
     cleanup `platform/deleteSession` does for the old id (tombstone, undelivered, active turn, run
     results, superseded echoes) and close the old harness session.
   - Submit the edited prompt to the new session through the scheduler with the client's
     `promptId`, as a normal `session/prompt` from the calling channel, and answer
     `{ sessionId: newId }`.
   - Broadcast the change on the sessions watch (`sessions.watch` already announces new and
     deleted sessions — confirm it does for a tombstone) so other tabs follow.
5. **UI**:
   - `chat-message.tsx`: an Edit action (Carbon `Edit`) on user bubbles, shown only when the
     session is idle, `rewrite` is true and the bubble is not queued (queued edit is 02).
   - Inline editor as in 02; Save calls `rewriteFrom` (new op in `acp-session-ops.ts`), then
     navigates to the new session id with `replace` so Back does not land on the deleted one, and
     focuses the transcript at the rerun.
   - Other tabs on the old session: on the tombstone, follow to the newest session or show the
     existing "session deleted" state (keep it simple; note in the PR).
6. **Docs** — `agent-lifecycle.md` "Session inside the pod": a session can be rewritten from a
   message, which forks it and replaces the original. (Done in `sessions.md`: the session sections
   moved there from `agent-lifecycle.md`, which was at its size cap.)

## As built (notes)

- The fork capability reaches the UI from the `initialize` answer (as 03's steering does), not as
  load meta; the UI decides eligibility from the session's type in the session list.
- The harness titles a fork "<title> (fork)": the UI passes the session's title and the runtime
  keeps it as the Session's own title.
- A fork is not yet held by the harness: the runtime fills its transcript from the harness and
  reloads it before the edited prompt runs, so it opens with its history.
- The original is retired like a deleted Session (tombstoned, its platform state dropped), not
  removed from the harness's store.
- Steered messages are not rewrite points: a fork cut mid-turn would separate a tool call from its
  result.

## Acceptance criteria

- [ ] Editing user message 2 of 4 on an idle Claude Code session leaves messages 1–2 (edited) and
      a new answer; messages 3–4 and their answers are gone, also after a reload.
- [ ] The agent's memory matches: asked "what did I say before this?", it cites message 1 only.
- [ ] The session list shows one session (not two) with the same title.
- [ ] Editing the first message works (no fork point).
- [ ] Edit is not offered while a turn runs, on queued bubbles, on Codex/Bob/pi, or on scheduled
      or channel sessions.
- [ ] Package tests pass (agent-runtime, ui, api-server-api).

## Smoke test

On a Claude Code agent: send "my name is Ann", then "what is my name?", then "my favourite colour
is red". Edit the second message to "what is my favourite colour?" — the reply says it does not
know (message 3 is gone). Reload: three messages are not there, the list has one session.

## Rework after review (operator)

- **Two actions, chosen up front** as in Claude Code: Rewind and Fork on each eligible user
  message, instead of one Edit. The editor knows the action and previews it while you type:
  Rewind fades the messages it will remove behind a line that says how many; Fork says the
  conversation stays as it is.
- **Fork** keeps the original: same harness fork, the copy titled "<title> (fork)", its own
  creation time; nothing is retired.
- **No reload**: the tab sends `rewriteFrom` on its live connection, trims its transcript in place
  and switches to the new id without loading it; the runtime answers before the new session's
  first frame so the tab already follows the new id. The edited prompt is not editable while it
  briefly queues behind the harness load.
