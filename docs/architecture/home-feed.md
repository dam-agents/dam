# Home feed

Last verified: 2026-10-30

Home answers one question: what has happened since you last looked, and what still needs you.
It is the first surface a user sees, and the only one that spans every Agent they own — including the ones that are asleep.
Two surfaces read it: the sidebar's **Activity** section lists the newest Sessions of every Agent, and the **approvals bell** lists what waits on the user's decision.
The bell sits in the page's own top corner, and opens Approvals as a drawer over the page.
The [Get started](getting-started.md) checklist floats as a dock of its own in the lower right corner.
In an Agent's chat the bell sits in the chat's top bar and opens that same drawer.

## What Home reads

Three sources sit behind the feed, and they are deliberately different kinds of thing; [default-model notices](#default-model-notices) and [outage alerts](#outage-alerts) are read beside them.

**Approvals** come from their own table: a decision is genuinely pending until someone makes it, so it is durable state the api-server owns outright.
A spend-limit question is an approval too, but it belongs to no session: its card offers only "Continue", and it stays open until the next UTC midnight ([spend-limits](spend-limits.md#continue)).
A rule an Agent proposes is an approval too ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)): its card shows the rule and the Agent's reason, offers "Allow", the whole host or "Decline", and shows in the Agent's chat beside its held network requests.
A tool approval — the harness asking to run a tool — is written by two paths into one row.
Its card offers only the choices the harness offered for that request: a verdict reaches the harness as the option of its kind, and one with no such option would cancel the tool call, so a request with no "always" option, such as Bob's writes to its own settings, offers no "Always allow" or "Always deny".
The chat relay mirrors the prompt while a client engages the session, and the agent-runtime reports it over the runtime channel when no client does, so a request in a session nobody has open is on Home as soon as the agent asks.
Both use the same row id, so a client that engages later joins the row and it keeps the time the agent asked.
The runtime reports the end of every permission request it held, watched or not: an answer settles the row on the verdict the harness actually got — the runtime accepts one answer, so it, not the path that wrote the row, decides what the record says — and a request it dropped unanswered — its ten-minute wait ran out, or the session was reset ([sessions](sessions.md)) — expires it.
The end can arrive before the row: the relay forwards a prompt before it records it, so a session that resets in between leaves an end with nothing to settle.
Such an end settles the request's row all the same, which keeps a late write from turning a request that is over into a decision Home still offers.
**Live agent state** says which Agents are awake right now, and comes from the same Agent watch that feeds every other surface.
**Sessions** come from the attention record — a per-owner, server-side account of the sessions that have asked for attention.

The record exists because the Agent cannot answer for itself.
Session state is agent-owned (see [persistence](persistence.md#the-machine-disk)), so a hibernated Agent has nobody to ask, and before the record Home simply could not show what happened on an Agent that had since gone to sleep.
Waking every Agent to render a list would be absurd — it would defeat hibernation for the one surface a user opens most.

## The record and its boundary

One row per session, filed under the owner who should see it.
The row carries enough to render a feed card and to decide whether it is unread: when the session was last active, when it was last seen, whether it was working at capture time, how it was started, who started it (its Session Starter, see [agent editors](agent-editors.md#who-did-what)), which harness ran it, and the thread key that names the Slack channel or Telegram chat it came from.
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
The sidebar's Agents section lists the Sessions of an Agent only while the user has it open, and the Agent whose chat or configuration page is shown is open.
A click on a closed Agent opens its list and its new-session page, so its files and artifacts show beside the chat; a click on an open Agent only closes its list and leaves the page where it is.
An open Agent lists five Sessions, and each **View more** shows five more and moves keyboard focus to the first of them.
When the new rows come later, from the Agent's own list after its last known Sessions or from a Retry of a failed page, focus moves once they show.
An open Agent that is not the shown one lists the record's rows; the shown Agent lists its own list, and so does any Agent once the user asks for more.
It offers more only when rows are hidden or more may exist: a feed shorter than its row limit lists every row filed for the owner.
An open Agent with no row in a whole, loaded record shows "No sessions yet."; while the record is cut off, loading or unreadable, it lists its own list instead.
Opening an Agent's Sessions wakes a hibernated Agent once per open, as opening its chat does ([agent-lifecycle](agent-lifecycle.md#wake)), so its own list loads when it answers.
An open lasts until the Agent's list closes: a sidebar that mounts again, or the mobile drawer's copy of it, does not wake the Agent again.
When it stays asleep, because its wake failed or is not allowed, and the record holds none of its Sessions, the list offers a retry that wakes it.
When that list's own first read fails, it offers a retry instead of "No sessions yet."
View more asks the Agent for one more page of its list only when the loaded rows run out, and the list stops offering more when a page brings no new Session or the Agent's cursor does not move.
Opening a Session from Activity leaves its Agent's row as it was, closed or open.

The sidebar lists Agents in one **manual order** the user changes by drag and drop or with Alt+Up and Alt+Down, oldest created first until they do.
An Agent the order does not name yet, a new Agent, joins the foot of the list, and neither a click nor activity moves an Agent.
Hibernated Agents fold under **See all (N hibernating)**, unless the user has clicked its row or its chat or configuration page is shown, so closing an Agent's Sessions keeps its row in place.
An Agent's row shows a blue dot, also while it is open and shown, when one of its Sessions is unread in the record or in its own list already loaded; its hover actions are a session **filter**, **New session** and **Configure agent**, and a ⋮ menu with Add to Slack channel or Telegram chat only where the installation has them.
The Agent's filter keeps its Sessions by status and by type, like the Activity filter, but narrows only that Agent's list, not Activity; it is kept in the browser per Agent, and while it is on its control stays shown with a mark.
A move stores the whole list as the user sees it, so the Agents the user did not touch keep their places too.
The api-server keeps the order per user, so it follows the user to every browser, and drops an Agent's entry when the Agent is deleted.
The order is only a list of ids: it never decides that an Agent exists, and an id that names nothing shows nothing.

The Sessions of each Agent are listed by **last activity, newest first**, and the user does not reorder them: a new Session, or a turn in an old one, puts that Session at the top.
A Session row shows a blue dot while it is unread, and an approval dot in its place while an approval waits on the user.

The **Activity** section, below the Agents, lists the record's rows for every Agent, newest activity first, each with its Agent's avatar and name and its time, and after the time the email of whoever started the Session when that is not the viewer.
Its filter keeps Sessions by status (All, Needs attention, In progress, Unread) and by type (Chat, Slack, Telegram, Schedule, Terminal); Needs attention is a Session with an approval waiting on the user.
The filter is kept in the browser, so it survives a reload but does not follow the user to another device; both layouts share it.
The two sections scroll together, each header staying at the top while its section is in view.
The record's rows and the Agent's own list are both newest first, and each View more appends an older page, so the rows already shown keep their places.

That boundary is what makes the record safe to rebuild or discard.
Dropping it costs a user their feed history and nothing else; the next capture refills it from the Agents.
It is deliberately not in the [kept-on-purpose set](persistence.md#lifetime) that the session directory belongs to — the session directory is kept because spend must stay attributable, while the attention record is a convenience that may be thrown away.

## The producer

One lease-elected watcher writes the record.
It holds a session watch on every awake Agent in the install — not only the ones whose owner happens to have a browser tab open — and captures what it reads.

The notices it acts on carry no state.
A notice means "this Agent's session list changed, re-read it", the same contract every agent-sourced watch in the system uses (see [platform-topology](platform-topology.md#api-server)).
The watcher pulls the list, compares it against what it last wrote, and writes only rows that actually differ.
The comparison runs both ways: a session the Agent no longer lists has its row removed, along with any dismissal recorded against it.
That is what keeps the Agent authoritative for existence in practice and not just in principle — a deleted session stops being mentioned rather than lingering as a card nothing stands behind.
A backstop reconcile bounds the loss if a notice is missed, and Agents whose runtime image predates the watch surface are polled instead.
An Agent that has not yet reported its runtime features is polled too, so a poll often targets a machine that is still starting or will never start.
Each poll read is bounded in time and ends when the Agent leaves the watcher's list, so an Agent deleted before its machine answered does not leave a socket that retries until the replica restarts.
A live watch's read is bounded in time too.
When it does write, it emits the same per-owner invalidation hint every other domain emits, so open tabs re-read over the query path rather than being pushed rows.
The same pass reports a session that stops running to the [Kit Update](starter-kits.md#kit-update) reminder, which sends its one notice into that session.

Two consequences are worth stating plainly, because both are costs.
A busy Agent now reports whether or not a human is looking — the watch is no longer scoped to who has a tab open.
And the comparison state is in memory, held by whichever replica holds the lease: a row the retention trim removes is not known to be gone, so it is re-created on the next hold rather than staying deleted.
That is harmless — the row is a fresh capture of live state — but it means retention trims history, not the present.

## Default-model notices

The bell also lists the Agents on the Model Router whose saved default stops a run nobody picks for ([harness configuration](harness-config.md)): none is set, the Agent holds no model provider to pick one from, the provider its model names is no longer the Agent's, or the conversion of an old default runs it on another model than its setting named.
That state stops real work only where an Agent runs unattended, so one with no enabled Schedule and no bound Slack or Telegram Channel is not listed for it: nothing of its own fails yet.
[Outage alerts](provider-status.md#outage-alerts) use the same rule for an Agent that runs unattended.
A Slack Channel and a Telegram chat are stored apart, each where its own binding flow writes it, so the reader asks both stores for the Agents they hold rather than one for both.
The conversion's note is not a run that fails, and it is shown whatever the Agent runs.
An Agent on an older runtime runs a default with no model on its harness's own model, so it gets no notice.
They are computed on every read from the Agent's saved default, its granted providers, the conversion's note and what it runs unattended, so a sleeping Agent is never woken for them and setting a default clears the notice with no write of its own.
A pending default, one still being converted, says nothing.
The same notice puts a line under the chat's model control, a count in the banner on Home, and "Won't run" on the Agent's schedules that name no model.
Only the bell's card can be dismissed, per Agent and state; the others show every notice that stops runs, and a changed default is shown in the bell alone.
A dismissal is dropped once its notice no longer holds, so the same state coming back later is shown again, and an Agent's dismissals go with it.
Saving a default or converting one sends the owner the attention and harness-config hints, so open tabs re-read both the notice and the default.
Any change that decides whether a notice holds reaches the owner's open tabs, not only the tab that made it: a Schedule change sends the schedules hint, and a Slack or Telegram binding added or removed — in the UI, in Slack, or in Telegram — sends the attention hint.
An Agent's providers refresh the list in the tab that changed them.

## Outage alerts

The bell also lists the owner's [outage alerts](provider-status.md#outage-alerts): a provider outage that failed their unattended work, with each Agent, what failed, and a way to switch its provider.
An owner sees it only after their unattended work failed, so an outage that touched none of their work shows no card.
It counts in the panel's badge like an approval, so it reaches an owner who never linked Slack.
An alert shows while the owner is told about it, and for seven days after the provider works again.
A dismissal is per owner and on the server, and names the provider's template, the outage's start time and whether it recovered: it holds on every device, and a new outage or the recovery shows the card again.
A dismissal is dropped once its alert is gone.
The banner on Home does not count an outage alert, because the provider status banner already names a live outage on every page but the chat.
A new or recovered alert reaches open tabs through the attention hint.

## Seen, unread, and dismissed

Unread is derived, never stored as a flag: a session is unread when its activity is newer than the point it was last seen.
Both are watermarks, so they compose without a write for every card rendered, and nothing has to be marked read as a side effect of looking at a list.

The seen watermark is the Agent's.
The agent-runtime stamps it while a viewer is attached to a session — machine-driven channels do not count as viewers — and the watcher snapshots it into the record so a sleeping Agent can still answer.
Dismissal is the user's own watermark, stored per user against the item: dismissing hides an approval from the bell without resolving it, without marking anything read, and without touching running work.
The sidebar lists Sessions as they are and reads no dismissals.

Read state is **per session, not per person**, and it is the owner's.
An [Agent Editor](agent-editors.md) using a Shared Agent's session is a viewer that never stamps it seen, so an editor reading a session leaves it unread for the owner.
An editor gets no Home feed items or unread marks for a Shared Agent.
The dismissal watermarks are already keyed per user, so per-person read state would need no migration for that half.

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

- **Widen the Agent's existing session-directory report into a push.** Cost would then track events rather than awake Agents.
  It requires a fleet-wide agent image first, because a hibernated Agent on an older image contributes nothing until it is updated.
- **Shard the lease**, so each row still has exactly one writer while the Agents are divided across holders.
  This preserves the single-writer property the no-op guard depends on.

The order matters: sharding is the mechanical fix and stays within the current design, while the push changes what the Agent is responsible for.
