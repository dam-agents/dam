# 07 — Document it

**Depends on:** 06-terminal-unread
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

The architecture docs are the source of truth for how the system works, and three of their claims
are now false: that Home reads sessions from each running agent, that read state lives in the pod,
and that the api-server holds owner-wide session watches only while a browser subscribes. There is
also no page that owns the feed at all. Follow
[documentation-guidelines](../../guidelines/documentation-guidelines.md).

## Implementation plan

1. **New page `docs/architecture/home-feed.md`.** It owns the attention record and the surface it
   feeds. `agent-lifecycle.md` is at 38.5k of the 40k-character cap, which is why this is its own
   page — and the ADR's `subsystem:` was set to `home-feed` in sub-issue 01 to match. Cover, in
   prose, at the altitude of the other pages:
   - what Home answers, and the three sources behind it: approvals from their own table, the
     attention record for sessions, and live agent state for what is working now;
   - the record's boundary — one row per session, never consulted for which sessions exist, a
     missing row means nobody was told, safe to rebuild or discard;
   - the producer: one lease-elected watcher, watching every running agent install-wide, pulling
     on a notice, writing behind a no-op guard, emitting the hint every other domain emits;
     agents without live updates are polled;
   - seen and dismissed as per-user watermarks, what each currently derives from, and that read
     state is still per session until the sharing epic makes it per person;
   - terminal sessions: one viewer at a time, activity stamped while detached;
   - retention at 90 days, and that the rows follow their Agent.

2. **Index it.** Add the one-line entry to `docs/architecture.md`, in the list's existing voice.
   The index has a tighter 8k cap and sits near it, so keep the line to one sentence.

3. **`docs/architecture/platform-topology.md`** — two paragraphs need correcting:
   - the *Domain events and live updates* paragraph says a Home tab makes the api-server watch
     the session lists of every running agent its owner has. That watch is now held by a
     lease-elected watcher for every agent in the install, regardless of whether anyone is
     watching, and browsers no longer hold a session subscription of their own. Say so, and say
     what it costs — a busy agent now reports whether or not a human is looking.
   - the session paragraph ends "Read state is per-session, not per-user: agents currently have a
     single driving user, and shared-agent work must revisit this." Keep the conclusion, move the
     mechanism: the stamp is still the pod's, but it is snapshotted into the record so a sleeping
     agent can answer. Remove the claim that Home's feed reads go over the ACP `session/list`
     intercept, and adjust the UI component bullet that lists Home's remaining polls.

4. **`docs/architecture/persistence.md`** — add the two tables where the others are described,
   with their lifetime: agent-scoped rows cleaned up on Agent delete via the registered hook and
   the orphan sweep, trimmed at 90 days, storing the real owner sub. Name them in the cleanup list
   sentence. They are not in the "kept on purpose" list — unlike the session directory, they may
   be discarded.

5. **Check the budgets.** `mise run //docs:check:doc-size` is the authoritative gate; a page over
   its cap must be consolidated, not split arbitrarily.

## Acceptance criteria

- [ ] `docs/architecture/home-feed.md` exists and explains the feed and the record without naming
      file paths, function names, or table columns.
- [ ] `docs/architecture.md` links it.
- [ ] No architecture page still says Home reads sessions per agent, that browsers hold the
      owner-wide session watch, or that the pod's read state is what Home renders.
- [ ] ADR-089's `subsystem` matches the new page's name.
- [ ] `mise run //docs:check` passes, doc-size included.

## Smoke test

```
mise run //docs:check
grep -rn "podSessions\|per-agent pod reads" docs/architecture/    # nothing stale left
```

Then read `home-feed.md` end to end against the running system and confirm each claim is one you
just watched happen in sub-issues 03 through 06.
