# 04 — Dismiss, clear all, and `platform/markSeen`

**Depends on:** 01-home-shell-feed
**Part of:** A Home page — see [README](./README.md)

## Context

The feed lets a user dismiss an item, or clear all of them. Dismissal has to survive a reload — a
"clear all" that forgets itself on refresh is worse than not having one. For unread sessions, dismissal
*is* marking read, and read state lives in the sandbox pod. Today the runtime only records a session as
seen when it is loaded, engaged or prompted, so there is no way to mark one read without opening it.
This slice adds that way.

This is the only slice touching `packages/agent-runtime`. Apply `/typescript-engineering` for the
runtime work and `/react-ui-engineering` for the UI. Read
[agent-lifecycle](../../architecture/agent-lifecycle.md) before changing session behavior — the
session metadata store and the in-flight reporting contract are described there.

## Implementation plan

### 1. What dismissal means per kind

- **Unread session** — dismissal is marking read. It persists, via the new ext-method below.
- **Approval** — not dismissible from the feed's dismiss affordance. Approvals already have their own
  `dismiss` mutation with server-side meaning (slice 03); do not overload the feed control with it.
- **Running session** — not dismissible. It clears itself when the work finishes.

So "clear all" marks every unread item read and leaves approvals and running work untouched. Make that
visible in the control's copy — a "clear all" that silently skips two thirds of the feed needs to say
so.

### 2. The ext-method — `packages/agent-runtime`

`packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts` already dispatches
`platform/deleteSession` around line 858. Add `platform/markSeen` beside it, taking a session id and
calling `sessionMetadata.recordSeen(sessionId)` —
`modules/acp/infrastructure/session-metadata-store.ts` already exposes exactly that method, currently
called only from `server.ts` and from three places inside `acp-runtime.ts` when a session is loaded,
engaged or prompted.

Keep it idempotent and silent on an unknown session id: `recordSeen` already no-ops when the entry is
missing, and a dismissal racing a session deletion must not error.

This changes no ACP-facing behavior for harnesses — it is a platform ext-method, like its neighbour.

### 3. The client call — `modules/sessions/api/acp-session-ops.ts`

Add `markAgentSessionSeen(agentId, sessionId)` next to `deleteAgentSession`, which is the pattern to
copy. Note `deleteAgentSession` does **not** pass `{ passive: true }` — decide deliberately whether
marking seen should be passive, and prefer passive: dismissing a feed item must never wake a pod. Since
the feed only shows unread for running sandboxes, the pod is up either way, but passive keeps the
guarantee honest.

`modules/sessions/api/queries.ts` already has `setSessionSeen(agentId, sessionId)`, which is only an
optimistic cache write. Keep it, and call it alongside the new durable call so the item disappears
immediately.

### 4. The UI

Dismiss on each dismissible card, and a clear-all control on the feed header — structure from the
prototype. On failure, restore the item and say why; a dismissal that looks like it worked but did not
persist is the failure mode to avoid.

Clear-all fans out over unread items, so it is N calls. Bound it to what is on screen, report partial
failure honestly ("3 of 5 cleared"), and do not block the whole action on one bad pod.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test`, `--force agent-runtime:check`,
      `--force agent-runtime:test` and `--force common:check:comment-types` pass.
- [ ] Dismissing an unread item removes it, and it is still gone after a reload.
- [ ] Clear-all marks every unread item read and leaves approvals and running sessions in place, and
      says that it does.
- [ ] `platform/markSeen` is idempotent and no-ops on an unknown session id.
- [ ] Dismissal never wakes a hibernated pod.
- [ ] A failed dismissal restores the item and surfaces the error.
- [ ] Partial failure of clear-all is reported, not swallowed.
- [ ] Sessions marked seen this way appear read in the existing sessions sidebar too.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
mise run --force agent-runtime:test
```

The runtime change needs a real pod, so this part is a cluster step — see the `cluster-ops` skill:

```sh
mise run cluster:install
```

Then on the dev server at `localhost:5173`, with a running sandbox carrying an unread session:

1. Dismiss the unread item, reload Home, and confirm it stays gone.
2. Open the sandbox's sessions sidebar and confirm the same session reads as seen there.
3. Create two more unread sessions, clear all, reload, and confirm all are gone while a pending
   approval and a running session remain.
4. Confirm the clear-all copy tells the user approvals and running work are untouched.

If you cannot reach a cluster, say so plainly in your report rather than implying the ext-method was
exercised — `agent-runtime:test` covers the store, not the wire.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
