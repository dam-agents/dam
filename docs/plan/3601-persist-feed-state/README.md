# Persist activity feed state reliably

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3601

## Goal

A user opening Home sees what needs their attention since they last looked — including
from agents that finished and went to sleep — and what they saw or dismissed stays seen
or dismissed on every device.

Today none of that holds. Home reads sessions live from each running agent, so a
hibernated agent contributes nothing and an overnight run leaves no trace. Read state
lives inside the pod, so a sleeping agent cannot say what you have read. Dismissals live
in browser local storage, capped at 300 keys, so hiding something on a laptop does not
hide it on a phone.

## Approach

The platform keeps a **per-owner attention record**: one row per session, holding what the
feed needs to render it, written by a lease-elected watcher in the api-server. The agent
stays the sole source of truth for which sessions exist — the record is never consulted to
answer that, so a missing row means nobody was told, not that nothing happened. This is
[ADR-089](../../adrs/089-notification-record.md), promoted from draft by sub-issue 01.

The producer consumes the pod surface [ADR-086](../../adrs/086-pod-owned-live-updates.md)
already built: the watcher holds `sessions.watch` to every running agent install-wide and,
on each notice, re-reads `sessions.list` and upserts the record behind a no-op guard. The
upsert emits a domain event, the live-hints saga projects it as an ordinary per-owner hint,
and Home re-reads — so sessions stop being special and the owner-wide pod subscription
browsers hold today is retired.

Seen and dismissed live beside the record as per-user rows.

### What this delivers and what it defers

The ADR's full design derives "seen" from relay presence: a turn relayed while a *visible*
viewer is attached means the user was watching. That is deferred, deliberately. The relay
tracks viewers per **agent**, not per session, and nothing in the browser reports page
visibility, so it is a large change across the browser, the relay and the pod — and its
only unique payoff is per-person read state, which nothing in the product can use yet. An
agent has exactly one owner, cannot be transferred, and roles do not exist; that is epic
[#3218](https://github.com/dam-agents/dam/issues/3218), which also reopens approvals when it lands.

So this feature snapshots the pod's existing `seenAt` stamp into the record, which already
makes unread work for a hibernated agent, while keying the state table per user from day
one so the follow-up needs no migration. The follow-up — presence-derived seen, retiring
the pod's read state — is filed against #3218.

### Decisions worth stating once

- **In progress is never trusted from the record alone.** The record stores whether a
  session was working at last capture; Home shows it as in-progress only while the agent is
  *currently* running per the agents list. A pod that dies without notice therefore leaves no
  phantom work on the page, which is the rule the ADR cares about, without a live per-session read.
- **Terminal sessions are in.** The pod already knows, unambiguously, whether a terminal
  session has a viewer — at most one WebSocket per session — and already stamps seen only
  while one is attached. What is missing is an *activity* stamp: no PTY path calls
  `recordActivity`, so a terminal session's `updatedAt` never moves and unread could never
  fire. Sub-issue 06 adds that stamp for output produced while detached.
- **Dismissal covers approvals too.** Home and the floating pill let a user dismiss both
  unread sessions and pending approvals today, both into local storage. Approvals keep their
  own table and get no attention record, but the per-user dismissal state is one table for
  both, so "dismissals follow you" is true for the thing users dismiss most.
- **A new table, not the existing session directory.** `agent_sessions` exists, but it is the
  spend-attribution directory: no owner column, kept 180 days so spend stays attributable.
  Different purpose, different lifetime.
- **Retention is 90 days**, trimmed by a periodic job. Home's feed window is 7 days, so
  nothing a user could still see is ever trimmed.

### The contract both halves implement against

`packages/api-server-api/src/modules/attention/types.ts`:

```ts
export interface AttentionItem {
  agentId: string;
  sessionId: string;
  mode: "chat" | "terminal";
  type: SessionType;            // reuse the session type union
  title: string | null;
  scheduleId: string | null;
  experimentId: string | null;
  createdAt: string;            // ISO
  activityAt: string | null;    // the session's last activity, snapshotted
  seenAt: string | null;        // the pod's stamp, snapshotted
  working: boolean;             // was working at last capture
}

export interface AttentionList {
  items: AttentionItem[];
  dismissed: DismissedEntry[];  // this user's watermarks, all kinds
}

export interface DismissedEntry {
  kind: "session" | "approval";
  id: string;                   // session: `${agentId}:${sessionId}` — approval: approval id
  at: string;                   // ISO
}
```

Router (`attention`):

- `listForOwner()` → `AttentionList` — owner-scoped, no input, the caller's own watermarks.
- `dismiss({ kind, id })` → `void` — stamps `dismissedAt = now()`.

Hiding rules: a **session** is hidden while `activityAt <= dismissedAt`, so new activity
returns it with no explicit un-dismiss. An **approval** is hidden once a row exists, because
an approval resolves rather than re-activating. Unread stays the rule it is today —
`activityAt > seenAt` — only the source moves.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ✅ Accept the notification-record ADR | Promote the draft to `089`, status accepted, staging and open questions written in | — |
| 02 | ✅ The record and its read path | Two tables, migration, repository, owner-scoped read, agent-delete cleanup, 90-day trim | 01 |
| 03 | ✅ The watcher that writes it | Lease-elected watcher, pull on notice, no-op-guarded upsert, domain event and hint | 02 |
| 04 | ✅ Home reads one query | Home reads the record; hibernated agents appear; the owner-wide pod subscription is deleted | 03 |
| 05 | ✅ Dismissals that follow the user | Dismiss mutation and the UI switch off local storage, sessions and approvals | 04 |
| 06 | Unread for terminal sessions | Stamp activity on detached PTY output; drop the terminal exclusions | 05 |
| 07 | Document it | New architecture page, index entry, platform-topology and persistence updates | 06 |

## Conventions & glossary

- **Attention record** — one row per session, per owner, holding what Home renders. Never
  consulted for which sessions exist.
- **Watermark** — a timestamp, not a flag. Unread means activity later than the seen mark;
  hidden means activity no later than the dismissed mark.
- **Notice** — a pod-originated "re-read", never carrying state (ADR-086).
- **Hint** — a per-owner invalidation on `events.owner`: a topic plus ids, never entity state.
- Module name is `attention` throughout: tables `attention_records` / `attention_state`,
  api-server module `packages/api-server/src/modules/attention/`, contract
  `packages/api-server-api/src/modules/attention/`, hint topic `attention`.
- Owner columns store the **real** Keycloak sub (`owner_sub` / `user_sub`), never the
  pseudonymized one the usage mirror uses — see [persistence](../../architecture/persistence.md).
- No Postgres table references an Agent by foreign key; agent-scoped rows are cleaned up
  by a registered hook and backstopped by the orphan sweep.
- Apply `/typescript-engineering` for everything under `packages/api-server`,
  `packages/api-server-api`, `packages/agent-runtime`; apply `/react-ui-engineering` for
  `packages/ui`.

## Whole-feature smoke test

On the dev cluster, with the UI running from the Vite dev server:

1. Give an agent a schedule that fires a short task. Let it fire, then let the agent
   hibernate (or hibernate it by hand).
2. Open Home in a browser that has never seen this session. The finished session appears,
   marked unread, with the agent asleep — today it shows nothing at all.
3. Dismiss it. Open Home in a different browser profile: still dismissed.
4. Drive one more turn on that session. It returns to the feed in both browsers, without
   any explicit un-dismiss.
5. Open a terminal session, start a command that prints for a minute, close the panel.
   Home shows that session unread while it keeps printing; reattaching clears it.
6. Watch the network panel: no per-agent session fan-out, one `attention.listForOwner`
   read, and updates arriving over the single `events.owner` subscription.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#3601](https://github.com/dam-agents/dam/issues/3601).
