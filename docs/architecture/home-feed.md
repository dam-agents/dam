# Home feed

Last verified: 2026-10-20

Home answers one question: what has happened since you last looked, and what still needs you.
It is the first surface a user sees, and the only one that spans every Agent they own — including the ones that are asleep.
Two surfaces read it: the sidebar's **Activity** section lists the newest Sessions of every Agent, and the **approvals bell** lists what waits on the user's decision.
The bell sits in the icon bar on the right edge of every page and opens the Approvals side panel, a panel like the Artifacts panel beside it, that takes its room from the page.
In an Agent's chat with the new layout off, the chat has no icon bar: the bell sits in the chat's top bar and opens the same panel in the slot beside the conversation.

## What Home reads

Three sources sit behind the feed, and they are deliberately different kinds of thing; [default-model notices](#default-model-notices) are a fourth, read beside them.

**Approvals** come from their own table: a decision is genuinely pending until someone makes it, so it is durable state the api-server owns outright.
A spend-limit question is an approval too, but it belongs to no session: its card offers only "Continue" and "Stop for today", and it stays open until the next UTC midnight ([spend-limits](spend-limits.md#continue)).
A tool approval — the harness asking to run a tool — is written by two paths into one row.
The chat relay mirrors the prompt while a client engages the session, and the agent-runtime reports it over the runtime channel when no client does, so a request in a session nobody has open is on Home as soon as the agent asks.
Both use the same row id, so a client that engages later joins the row and it keeps the time the agent asked.
The runtime reports the end of every permission request it held, watched or not: an answer settles the row on the verdict the harness actually got — the runtime accepts one answer, so it, not the path that wrote the row, decides what the record says — and a request it dropped unanswered — its ten-minute wait ran out, or the session was reset ([sessions](sessions.md)) — expires it.
The end can arrive before the row: the relay forwards a prompt before it records it, so a session that resets in between leaves an end with nothing to settle.
Such an end settles the request's row all the same, which keeps a late write from turning a request that is over into a decision Home still offers.
**Live agent state** says which Agents are awake right now, and comes from the same Agent watch that feeds every other surface.
**Sessions** come from the attention record — a per-owner, server-side account of the sessions that have asked for attention.

The record exists because the pod cannot answer for itself.
Session state is agent-owned (see [persistence](persistence.md#per-agent-pvcs)), so a hibernated Agent has nobody to ask, and before the record Home simply could not show what happened on an Agent that had since gone to sleep.
Waking every Agent to render a list would be absurd — it would defeat hibernation for the one surface a user opens most.

## The record and its boundary

One row per session, filed under the owner who should see it.
The row carries enough to render a feed card and to decide whether it is unread: when the session was last active, when it was last seen, whether it was working at capture time, how it was started, which harness ran it, and the thread key that names the Slack channel or Telegram chat it came from.
The card resolves that key to a name on the client, from the channel list every Agent already carries and the Telegram chats of the Agents on the feed, so the record stores no channel names that could go stale.

The boundary matters more than the contents.
**The Agent remains the sole source of truth for which sessions exist** — the record is never consulted to decide that, and nothing reads it to decide whether a session is real.
It is a notification ledger, not a session store.
A missing row therefore means only one thing: nobody was told about that session.
It never means the session is gone.

One reader outside Home shows the rows: an Agent's session list, while that Agent cannot answer for itself — asleep, or still waking.
It shows its owner the rows filed for that Agent as a **provisional** list, and replaces it with the Agent's own list the moment the Agent answers.
The UI asks the Agent for that list once the Agent shows as starting, not first at Ready: the agent's tRPC relay holds the ask while the wake runs, and an ask it refuses, or a hold that fails, is asked again when the Agent turns Ready.
Nothing acts on a provisional row as proof the session exists: opening one asks the Agent, which still decides.
Rename and Delete on a provisional row wake the Agent and run once it answers, so the Agent still decides; a Delete asks its confirmation before the wake, and an Agent that stops before it answers changes nothing.
The sidebar's Agents section lists the Sessions of an Agent only while the user has it open: a click on the Agent opens or closes its list in place, and the Agent whose chat or configuration page is shown is open.
An open Agent that is not the shown one lists the record's rows, three at most; the shown Agent lists its own list, and so does any Agent once the user asks for more.
It offers more only when the record may hold more: a feed shorter than its row limit lists every row filed for the owner.
Once the list is expanded, each More asks the Agent for one more page of its list, and the list stops offering more when a page brings no new Session or the Agent's cursor does not move.

The sidebar lists Agents **newest created first**, in one **manual order** the user changes by drag and drop or with Alt+Up and Alt+Down.
An Agent the order does not name yet, a new Agent, goes to the top of the list, newest first, and neither a click nor activity moves an Agent.
Hibernated Agents fold under **See all (N hibernating)**, unless the user has one open or its chat or configuration page is shown; closing the shown Agent's Sessions keeps its row in place.
An Agent's row shows a dot when one of its Sessions is unread, and its hover actions are **New session** and **Configure agent**, and a ⋮ menu with Add to Slack channel or Telegram chat only where the installation has them.
A move stores the whole list as the user sees it, so the Agents the user did not touch keep their places too.
The api-server keeps the order per user, so it follows the user to every browser, and drops an Agent's entry when the Agent is deleted.
The order is only a list of ids: it never decides that an Agent exists, and an id that names nothing shows nothing.

The Sessions of each Agent are listed by **last activity, newest first**, and the user does not reorder them: a new Session, or a turn in an old one, puts that Session at the top.
A Session row shows a blue dot while it is unread, and an approval dot in its place while an approval waits on the user.

The **Activity** section, below the Agents, lists the record's rows for every Agent, newest activity first, each with its Agent's name and its time.
Its filter keeps Sessions by status (All, Needs attention, In progress, Unread) and by type (Chat, Slack, Telegram, Schedule, Terminal); Needs attention is a Session with an approval waiting on the user.
The divider between the two sections drags, and the browser keeps its place.
The record's rows and the Agent's own list are both newest first, and each More appends an older page, so the rows already shown keep their places.

That boundary is what makes the record safe to rebuild or discard.
Dropping it costs a user their feed history and nothing else; the next capture refills it from the pods.
It is deliberately not in the [kept-on-purpose set](persistence.md#lifetime) that the session directory belongs to — the session directory is kept because spend must stay attributable, while the attention record is a convenience that may be thrown away.

## The new layout

The **new layout** [experimental feature](features.md) replaces the app shell for the user who turns it on; with it off, everything above holds unchanged.
The sidebar becomes one tree: every Agent is a row that opens to that Agent's own list, every page of it, the next page loaded when the list scrolls near its end.
The Agent open in the page opens in the tree until its row closes it, and closes again when another Agent opens in the page, unless the user opened it; any other Agent opens and closes from its row, and the open state lasts until the page reloads; a page with no Agent open, such as Home, leaves every list as it was.
While the new layout is on (the saved preference decides until the flags load), each attention hint, which names its Agent, refreshes that Agent's own list and its single-Session lookups, and a sync (sent when the owner stream overflows or a tab subscribes again) refreshes them for every Agent in the cache, at most eight of these Session families at a time across all hints, a family already queued joining that pass, while the Agent list and other families refresh at once since a Session read waiting for its Agent to start ends only when the Agent list refreshes, so an open list and an old pin stay live without that Agent's chat, for Sessions outside the record window too.
A closed Agent row shows a mark for a waiting approval, or else for an unread Session, with a text equivalent; its New session and actions buttons show on hover or keyboard focus, and at all times on a device without hover; a New session row ends its open list and a New agent row ends the tree.
A Home row at the top of the tree opens the dashboard.
An Agent's open list with no Sessions shows only its New session row; a filter that leaves it empty says so.
An Agent's empty chat shows the Agent's avatar and name with no hover effect, and lists the ways into the Agent as on its General page: the CLI, editor and messenger rows open in place, from the pointer or the keyboard, and the opening does not animate under reduced motion.
The rows are a list of disclosure buttons, not an ARIA tree: Tab moves between them, and each Agent row names the list it opens.
An Agent's list slides open and closed in 200 ms, but not under reduced motion and not when it is already open as the page loads; a closing list leaves the Tab order at once.
Each Session row has an activity dot: orange for a waiting approval, a spinning blue ring while working, a green ring for background work, green for unread, a pen for a draft and gray when idle; unlike the current layout's blue unread dot, unread is green here, and a line naming its harness, model and source; a Session from the record alone has no model.
A Session row shows its harness icon in place of the harness name in its context line, and keeps its schedule, terminal and messenger icons; a pinned row leads with its Agent's avatar under the activity dot, since the Pinned section mixes Agents.
A pinned row shows no pin mark, since its section says it is pinned; its unpin button shows with its other actions, on hover or while the row holds keyboard focus.
The tree's Agents header carries one session filter, by state and by Session type: it narrows the Pinned section and every Agent's list, and the control shows a mark while a filter is on.
Beside it, a Group by menu offers All sessions or Group by agents, the tree; like the filter, the choice lasts until the page reloads.
All sessions replaces the Agents with one list of the unpinned Sessions in the owner's attention record, newest activity first, each row led by its Agent's avatar and name, twenty at a time with View more; a Session older than the record shows only under its Agent.
The filter narrows the pages already loaded, so while it is on an Agent's list loads a further page only when the user clicks **Load more**; when the filter is removed, every Agent's list keeps its first page only.
The tree keeps the same manual Agent order, set by drag and drop or with Alt+Up and Alt+Down; an Agent's own list keeps the newest-first order.
A Session can be **pinned**: a pinned Session moves to a **Pinned** section above every Agent and leaves its Agent's list; pinning from the keyboard keeps focus on the moved row, or on its Agent's row when that Agent is closed.
Pins are kept in the browser, so they do not follow the user to another device.
The Pinned section reads a pinned Session from the record, and one the record does not hold by its id from its Agent while that Agent can answer, seeded with the row it was pinned from so it shows at once, and offering a retry when its first lookup fails; the section orders all pins by latest activity; every pinned row has the same actions and spend as in its Agent's list; deleting a Session from the tree drops its pin, and a pin whose Session is gone otherwise shows nowhere but stays stored, since pins live only in the browser and no failed or stale list may count as proof that one is stale.
A pin of an asleep Agent that its record does not hold shows once the Agent wakes.
An asleep Agent whose Sessions the record does not hold shows a note that its Sessions show when it wakes; the tree never reads an empty record as an empty list.
Until the record answers, and for an Agent that cannot answer for another reason, the list shows its loading placeholder; a list whose first page failed offers a retry instead of saying the Agent has no Sessions.
An Agent's chat drops its top bar and its column of Files, Artifacts and Processes sections for the side panel and its icon bar: Files, Changes, Artifacts, Browser and Processes become tabs of the panel, beside Get started and Approvals.
Home becomes a dashboard of cards built from the record, the Agents list and the owner's schedules; its counts cover only the record's rows, at most the feed's row limit, so they describe recent work, not all time.
An Agent's runtime migration badge reads on its row in the Agents list and in the overlay of an Agent that is not running; the chat header carries it only below the width where the row shows.

## The producer

One lease-elected watcher writes the record.
It holds a session watch on every awake Agent in the install — not only the ones whose owner happens to have a browser tab open — and captures what it reads.

The notices it acts on carry no state.
A notice means "this Agent's session list changed, re-read it", the same contract every pod-sourced watch in the system uses (see [platform-topology](platform-topology.md#api-server)).
The watcher pulls the list, compares it against what it last wrote, and writes only rows that actually differ.
The comparison runs both ways: a session the Agent no longer lists has its row removed, along with any dismissal recorded against it.
That is what keeps the Agent authoritative for existence in practice and not just in principle — a deleted session stops being mentioned rather than lingering as a card nothing stands behind.
A backstop reconcile bounds the loss if a notice is missed, and Agents whose runtime image predates the watch surface are polled instead.
An Agent that has not yet reported its runtime features is polled too, so a poll often targets a pod that is still starting or will never start.
Each poll read is bounded in time and ends when the Agent leaves the watcher's list, so an Agent deleted before its pod answered does not leave a socket that retries until the replica restarts.
When it does write, it emits the same per-owner invalidation hint every other domain emits, so open tabs re-read over the query path rather than being pushed rows.

Two consequences are worth stating plainly, because both are costs.
A busy Agent now reports whether or not a human is looking — the watch is no longer scoped to who has a tab open.
And the comparison state is in memory, held by whichever replica holds the lease: a row the retention trim removes is not known to be gone, so it is re-created on the next hold rather than staying deleted.
That is harmless — the row is a fresh capture of live state — but it means retention trims history, not the present.

## Default-model notices

The bell also lists the Agents on the Model Router whose saved default needs their owner ([harness configuration](harness-config.md)): none is set, the Agent holds no model provider to pick one from, the provider its model names is no longer the Agent's, or the conversion of an old default runs it on another model than its setting named.
An Agent on an older runtime runs a default with no model on its harness's own model, so it gets no notice.
They are computed on every read from the Agent's saved default, its granted providers and the conversion's note, so a sleeping Agent is never woken for them and setting a default clears the notice with no write of its own.
A pending default, one still being converted, says nothing.
The same notice puts a line under the chat's model control, a count in the banner on Home, and "Won't run" on the Agent's schedules that name no model.
Only the bell's card can be dismissed, per Agent and state; the others show every notice that stops runs, and a changed default is shown in the bell alone.
A dismissal is dropped once its notice no longer holds, so the same state coming back later is shown again, and an Agent's dismissals go with it.
Saving a default or converting one sends the owner the attention and harness-config hints, so open tabs re-read both the notice and the default, and changing an Agent's providers refreshes the list in the tab that changed them.

## Seen, unread, and dismissed

Unread is derived, never stored as a flag: a session is unread when its activity is newer than the point it was last seen.
Both are watermarks, so they compose without a write for every card rendered, and nothing has to be marked read as a side effect of looking at a list.

The seen watermark is the pod's.
The agent-runtime stamps it while a viewer is attached to a session — machine-driven channels do not count as viewers — and the watcher snapshots it into the record so a sleeping Agent can still answer.
Dismissal is the user's own watermark, stored per user against the item: dismissing hides an approval from the bell without resolving it, without marking anything read, and without touching running work.
The sidebar lists Sessions as they are and reads no dismissals.

Read state is still **per session, not per person**.
An Agent currently has a single driving user, so the distinction has no observable effect today; the shared-agent work is what must revisit it.
The dismissal watermarks are already keyed per user, so that half needs no migration when it does.

## Terminal sessions

A terminal session admits one viewer at a time, which makes its presence unambiguous in a way a chat session's is not: either a client is attached to the pseudo-terminal or none is.
Seen is stamped while a viewer is attached and again when one leaves; activity is stamped for output produced while nobody is attached.
That pairing is what lets a terminal session be unread at all.

The subtlety is that not all output means work happened.
A viewer leaving causes a last resize, and the shell repaints in response; the idle reaper later kills the terminal, and the harness prints as it shuts down.
Both produce bytes after the last viewer is gone, and counting either one would mark the session unread every time a user closed it and again five minutes later.
Output during teardown — a short settle window after a viewer detaches, and the whole of a terminal being reaped — is therefore counted as neither activity nor liveness.

## Lifetime

Rows are agent-scoped and follow their Agent: an API delete removes them through the same declared cleanup list every other agent-scoped record kind uses, and the periodic orphan sweep backstops it (see [persistence](persistence.md#lifetime)).
Rows older than 90 days are trimmed by a periodic job, so the feed's cost tracks recent activity rather than an Agent's whole history.
A dismissal of an approval is the one per-user row with no record of its own to follow — an approval is not agent-scoped state the feed owns — so the same job trims it by age instead.
The owner is stored as a real Keycloak sub, not a pseudonymized one — the feed has to name a person's own sessions back to them, which a hash cannot do.

## Limits

The producer is a single lease-elected holder, so its ceiling is the number of concurrently **awake** Agents, not the number of Agents.
Hibernation means that is far below the install's size, and the watch is idle for an idle Agent.
Two escape hatches exist if that ceiling is ever reached, and neither has been needed:

- **Widen the pod's existing session-directory report into a push.** Cost would then track events rather than awake Agents.
  It requires a fleet-wide agent image first, because a hibernated Agent on an older image contributes nothing until it is updated.
- **Shard the lease**, so each row still has exactly one writer while the Agents are divided across holders.
  This preserves the single-writer property the no-op guard depends on.

The order matters: sharding is the mechanical fix and stays within the current design, while the push changes what the pod is responsible for.
