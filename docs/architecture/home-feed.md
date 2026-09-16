# Home feed

Last verified: 2026-09-16

Home answers one question: what has happened since you last looked, and what still needs you. It is the first surface a user sees, and the only one that spans every Agent they own — including the ones that are asleep.

## What Home reads

Three sources sit behind the feed, and they are deliberately different kinds of thing.

**Approvals** come from their own table: a decision is genuinely pending until someone makes it, so it is durable state the api-server owns outright. **Live agent state** says which Agents are awake right now, and comes from the same Agent watch that feeds every other surface. **Sessions** come from the attention record — a per-owner, server-side account of the sessions that have asked for attention.

The record exists because the pod cannot answer for itself. Session state is agent-owned (see [persistence](persistence.md#per-agent-pvcs)), so a hibernated Agent has nobody to ask, and before the record Home simply could not show what happened on an Agent that had since gone to sleep. Waking every Agent to render a list would be absurd — it would defeat hibernation for the one surface a user opens most.

## The record and its boundary

One row per session, filed under the owner who should see it. The row carries enough to render a feed card and to decide whether it is unread: when the session was last active, when it was last seen, whether it was working at capture time, and how it was started.

The boundary matters more than the contents. **The Agent remains the sole source of truth for which sessions exist** — the record is never consulted to answer that, and nothing reads it to decide whether a session is real. It is a notification ledger, not a session store. A missing row therefore means only one thing: nobody was told about that session. It never means the session is gone.

That boundary is what makes the record safe to rebuild or discard. Dropping it costs a user their feed history and nothing else; the next capture refills it from the pods. It is deliberately not in the [kept-on-purpose set](persistence.md#lifetime) that the session directory belongs to — the session directory is kept because spend must stay attributable, while the attention record is a convenience that may be thrown away.

## The producer

One lease-elected watcher writes the record. It holds a session watch on every awake Agent in the install — not only the ones whose owner happens to have a browser tab open — and captures what it reads.

The notices it acts on carry no state. A notice means "this Agent's session list changed, re-read it", the same contract every pod-sourced watch in the system uses (see [platform-topology](platform-topology.md#api-server)). The watcher pulls the list, compares it against what it last wrote, and writes only rows that actually differ. The comparison runs both ways: a session the Agent no longer lists has its row removed, along with any dismissal recorded against it. That is what keeps the Agent authoritative for existence in practice and not just in principle — a deleted session stops being mentioned rather than lingering as a card nothing stands behind. A backstop reconcile bounds the loss if a notice is missed, and Agents whose runtime image predates the watch surface are polled instead. When it does write, it emits the same per-owner invalidation hint every other domain emits, so open tabs re-read over the query path rather than being pushed rows.

Two consequences are worth stating plainly, because both are costs. A busy Agent now reports whether or not a human is looking — the watch is no longer scoped to who has a tab open. And the comparison state is in memory, held by whichever replica holds the lease: a row the retention trim removes is not known to be gone, so it is re-created on the next hold rather than staying deleted. That is harmless — the row is a fresh capture of live state — but it means retention trims history, not the present.

## Seen, unread, and dismissed

Unread is derived, never stored as a flag: a session is unread when its activity is newer than the point it was last seen. Both are watermarks, so they compose without a write for every card rendered, and nothing has to be marked read as a side effect of looking at a list.

The seen watermark is the pod's. The agent-runtime stamps it while a viewer is attached to a session — machine-driven channels do not count as viewers — and the watcher snapshots it into the record so a sleeping Agent can still answer. Dismissal is the user's own watermark, stored per user against the item: dismissing hides a card from Home without resolving anything, without marking anything read, and without touching running work.

Read state is still **per session, not per person**. An Agent currently has a single driving user, so the distinction has no observable effect today; the shared-agent work is what must revisit it. The dismissal watermarks are already keyed per user, so that half needs no migration when it does.

## Terminal sessions

A terminal session admits one viewer at a time, which makes its presence unambiguous in a way a chat session's is not: either a client is attached to the pseudo-terminal or none is. Seen is stamped while a viewer is attached and again when one leaves; activity is stamped for output produced while nobody is attached. That pairing is what lets a terminal session be unread at all.

The subtlety is that not all output means work happened. A viewer leaving causes a last resize, and the shell repaints in response; the idle reaper later kills the terminal, and the harness prints as it shuts down. Both produce bytes after the last viewer is gone, and counting either one would mark the session unread every time a user closed it and again five minutes later. Output during teardown — a short settle window after a viewer detaches, and the whole of a terminal being reaped — is therefore counted as neither activity nor liveness.

## Lifetime

Rows are agent-scoped and follow their Agent: an API delete removes them through the same declared cleanup list every other agent-scoped record kind uses, and the periodic orphan sweep backstops it (see [persistence](persistence.md#lifetime)). Rows older than 90 days are trimmed by a periodic job, so the feed's cost tracks recent activity rather than an Agent's whole history. The owner is stored as a real Keycloak sub, not a pseudonymized one — the feed has to name a person's own sessions back to them, which a hash cannot do.

## Limits

The producer is a single lease-elected holder, so its ceiling is the number of concurrently **awake** Agents, not the number of Agents. Hibernation means that is far below the install's size, and the watch is idle for an idle Agent. Two escape hatches exist if that ceiling is ever reached, and neither has been needed:

- **Widen the pod's existing session-directory report into a push.** Cost would then track events rather than awake Agents. It requires a fleet-wide agent image first, because a hibernated Agent on an older image contributes nothing until it is updated.
- **Shard the lease**, so each row still has exactly one writer while the Agents are divided across holders. This preserves the single-writer property the no-op guard depends on.

The order matters: sharding is the mechanical fix and stays within the current design, while the push changes what the pod is responsible for.
