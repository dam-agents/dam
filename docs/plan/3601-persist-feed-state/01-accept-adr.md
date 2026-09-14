# 01 — Accept the notification-record ADR

**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

The design this feature implements is written but never accepted: it sits at
`docs/adrs/DRAFT-notification-record.md`, status `proposed`, dated 2026-09-02. It was meant
to be promoted when its dependency (#3450, pod-owned live updates) merged, and was missed.
Implementing against a proposal would leave the architecture docs describing a decision that
is formally still open, so promotion is the first commit — and the place to record the two
things the plan settles that the draft does not: the staging of "seen", and terminal
sessions being in.

Its header still says ADR-084, which #3450 took; 085 through 088 are also taken, so this
becomes **089**.

## Implementation plan

1. `git mv docs/adrs/DRAFT-notification-record.md docs/adrs/089-notification-record.md`.
2. Frontmatter: set `id: 089`, `status: accepted`, and change `subsystem:` from
   `agent-lifecycle` to `home-feed` — the architecture page sub-issue 07 creates, since
   `agent-lifecycle.md` is at 38.5k of its 40k-character cap and cannot absorb this. Rewrite
   `summary:` so it names the staged shape rather than the full one.
3. Fix the body header line `# ADR: …` to match, and set **Status:** Accepted.
4. In **Decision**, keep the record, the boundary and the rules as written, and amend the two
   rules the plan changes:
   - *Seen and dismissed are watermarks* — keep, and add that the seen watermark starts as the
     pod's own stamp, snapshotted on capture, with the state table keyed per user from the
     first migration so the per-user watermark needs no schema change later.
   - *Seen is derived from presence* — restate as the committed direction rather than this
     record's delivery: the relay tracks viewers per agent and the browser reports no page
     visibility, so presence-derived seen and retiring the pod's read state follow with the
     sharing epic (#3218), which reopens approvals on the same grounds. Say plainly that until
     then read state stays per session, not per person.
   - *In progress is never stored* — refine to what the code will do: the record stores whether
     a session was working at last capture, and a reader shows it as working only while the
     agent is currently running, so a pod that dies without notice still leaves no phantom work.
5. Replace **Open Questions** with the answers, as prose in the appropriate sections:
   - Retention is 90 days, trimmed by a periodic job; the feed window is 7 days, so nothing a
     user could still see is trimmed. State that the per-user rows go with the record they
     annotate.
   - Terminal sessions are in. Explain why the earlier "no turn boundary" objection does not
     block it: a terminal session admits one viewer at a time, the pod already stamps seen only
     while that viewer is attached, and the missing half is an activity stamp for output produced
     while detached. No quiet-period rule is needed, because the pod already reports terminal
     liveness from an output window, which is what "still working" means for them.
   - Owner transfer does not exist — an agent has one owner, set at creation — so the owner
     stored on a record cannot go stale today; #3218 owns the question, and the record is
     rebuildable, so a transfer can re-capture rather than migrate.
6. Extend **Consequences → Harder** with the cost this plan discovered: an always-on watcher is
   a permanent subscriber to every running agent's session watch, so the pod's one-second PTY
   liveness sweep — today started only while some client subscribes — now runs whenever an agent
   is awake. Small, but it belongs in the record rather than being inherited silently.
7. Regenerate the index: `mise run //docs:generate:adr-index`.

Keep the ADR short. It is a decision record, not a design document: no code, no schema, no file
paths, and every sentence either changes the decision or its cost.

## Acceptance criteria

- [ ] `docs/adrs/089-notification-record.md` exists with `id: 089`, `status: accepted`,
      `subsystem: home-feed`; the draft file is gone (moved, not copied).
- [ ] The record states the staged seen source, terminal sessions being in, 90-day retention,
      and the always-on-watcher cost.
- [ ] No **Open Questions** section remains.
- [ ] `docs/adrs/index.md` lists 089 and matches regeneration.
- [ ] `mise run //docs:check:adr-index`, `//docs:check:adr-immutable` and `//docs:check:doc-size`
      all pass.

## Smoke test

```
mise run //docs:generate:adr-index
mise run //docs:check
```

`check:adr-immutable` is the one that matters here: it proves the promotion is a legal
draft-to-accepted transition and not a rewrite of an already-accepted record.

The implementing agent then prints the final Decision section for the user to read, since this
commit is the one a human should actually review word by word.
