# 04 — Dismiss and clear all

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

Dismissal **hides a feed item and nothing else**. It does not resolve an approval and does not mark a
session read — a settled decision, taken after the read-state approach below was already built.

- **Approval** — dismissible. The request stays pending and stays resolvable in the session, and the
  rail badge keeps counting it, so nothing is hidden-but-forgotten.
- **Unread session** — dismissible.
- **Running session** — not dismissible; it clears when the work finishes.

So "clear all" hides everything on screen except in-progress work, and says so.

### 2. Identifying what was dismissed

Dismissed keys live in `localStorage` for now; a server-side store belongs to
[#3100](https://github.com/dam-agents/dam/issues/3100) rather than a bespoke table here. Both keys
carry a version, because neither raw id is safe to hide on forever:

- `approval:<id>:<createdAt>` — an `acp_native` approval's id is
  `` `acpnative:${agentId}:${rpcId}` ``, and `rpcId` is the harness's JSON-RPC counter, which restarts.
  Without `createdAt`, dismissing one tool call would silently swallow an unrelated later one that
  reused the same rpc id.
- `session:<agentId>:<sessionId>:<updatedAt>` — so a session that speaks again comes back instead of
  being hidden for good.

Cap the stored set and drop the oldest, and accept two limits: dismissals are per-browser, and a
chatty session mints a new key every time it changes.

### 3. `platform/markSeen`

The runtime ext-method the earlier approach needed is already shipped, and now has no caller. Leave it
in place — a future explicit "mark as read" wants exactly it — but do not wire dismissal to it.

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
