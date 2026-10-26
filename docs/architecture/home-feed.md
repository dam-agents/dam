# Home feed

Last verified: 2026-10-26

Home answers one question: what has happened since you last looked, and what still needs you.
It is the first surface a user sees, and the only one that spans every Agent they own — including the ones that are asleep.
Two surfaces read it: the sidebar's **Activity** section lists the newest Sessions of every Agent, and the **approvals bell** lists what waits on the user's decision.
With either the JanUI or the Unified right toolbar experiment on, the bell sits in the icon bar on the right edge of every page and opens the Approvals side panel, which takes its room from the page.
With both experiments off there is no icon bar: the bell sits in the page's own top corner beside the Get started ring, and opens Approvals as a drawer over the page.
In an Agent's chat with both experiments off, the bell sits in the chat's top bar and opens that same drawer.

## What Home reads

Three sources sit behind the feed, and they are deliberately different kinds of thing; [default-model notices](#default-model-notices) and [outage alerts](#outage-alerts) are read beside them.

**Approvals** come from their own table: a decision is genuinely pending until someone makes it, so it is durable state the api-server owns outright.
A spend-limit question is an approval too, but it belongs to no session: its card offers only "Continue" and "Stop for today", and it stays open until the next UTC midnight ([spend-limits](spend-limits.md#continue)).
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

## The JanUI experiment

The **JanUI experiment** is an [experimental feature](features.md): it replaces the app shell for the user who turns it on; with it off, everything above holds unchanged.
The sidebar becomes one tree: every Agent is a row that opens to that Agent's own list of Sessions, every page of it, the next page loaded when the list scrolls near its end; the tree lists no [Environments](environments.md), which are a tab of the chat's side panel instead.
JanUI keeps its own navigation at every width.
What decides whether the navigation takes room beside the page is the room the page has left, not the viewport alone: below 768 px, or whenever the page would be left under 720 px once the navigation and the right rail are counted, the navigation stands aside as its rail whatever the user last chose, and their choice is kept for when the room comes back.
A rail already up waits for 40 px more than that minimum before it takes the room back, so a window dragged across the threshold does not flicker.
The pane's edge is dragged, and the width it is dragged to is held to what the page can spare: past the width that would leave the page under its minimum, the drag stops there rather than squeezing the page, so a drag is never what collapses the navigation.
Dragging the edge most of the way down from the narrowest width to the rail puts the navigation away, and dragging the rail's edge the same distance back out brings it back at its narrowest; the width the user last chose is kept for the next time it opens.
There is no bar above the page at any width, on Home or a Session alike: the rail is the navigation and the right rail is the panel, so the bar that stands in for both on a phone, and the chat's own bar with its menu button and panel tabs, are never drawn.
Expanding the rail there puts the pane itself in place of the page at once, the very same navigation a wide window shows, from the left edge up to the right rail, which stays visible, with nothing dimmed behind it and nothing sliding in, since no page is left to reach; picking a Session, pressing Escape or going back closes it.
An open right panel is laid over the page the same way, from the left rail up to the right rail, keeping its own top bar with the X that closes it rather than a bar of its own with a back button, and Escape, back or that X shuts it, as does going anywhere else from the rail; both overlays hold the keyboard while they are open and hand it back to what opened them.

Collapsed from its header, the sidebar stays in the layout one icon wide instead of leaving the page, its items one size, an Agent's avatar as large as in the expanded row and the icons around it to match: a tile expands it again, then Home, a New agent tile, what the tree lists under its Agents label, and Settings — one avatar per Agent in the tree's manual order while the grouping is Group by agents, or one tile per Session the header's filter leaves while it is All sessions, another page of the record joining its tiles as the column nears its end, a Session's tile drawn with the harness it runs, or the Chat or Terminal icon of a Session that names none, a dot while it awaits an approval or holds something unread, its Agent and title in a tooltip beside it since the rail has no room for either, and a click that opens that Session as its row in the tree does, pinned or not, since the rail keeps no Pinned tile of its own; an avatar opens that Agent's new-session page on click, as its New session row does, and opens what the tree would draw under it, in a popover beside the rail, on hover, on keyboard focus or on a long press where there is no hover, the popover leading with the session filter, New session and actions menu its row in the tree offers, and that popover closes on choosing a Session, while an avatar carries a dot while its Agent awaits an approval or holds an unread Session; the hairline above the tiles gives way to the tree's session filter and Group by buttons, side by side across the rail's width, while the pointer rests on it or the keyboard reaches them, so the two controls a collapsed pane has no label row for stay reachable and set the same filter and grouping the tree's Agents header does.
The tree's rows and the rail's tiles are laid out to one rhythm, so the chevron, Home, every avatar, the New agent row and Settings keep the same centre in both states, and collapsing looks like the labels leaving rather than the icons moving; the mark on the item the user is on is one row high and the pane's width less the tree's own 16 pixels of row padding, so it narrows with the pane rather than holding a shape of its own — a bar across the tree, a square in the rail — and a Session row inside an Agent's list carries that same mark while the page is on it; every row and tile lifts under the pointer by one shade, a step short of that mark, in either state, and either state's first mark stands the header's padding below the top of the screen rather than against it.
A collapse from the header animates the width with the tree still drawn inside it, at the width it has when the pane is open, so the narrowing column uncovers it rather than squeezing it: rows and their buttons keep their places and labels are cut by the pane's edge, while the whole tree fades out and the rail, drawn over the place the tree's own icons hold, fades in, the two crossing through the same 200 ms so no frame shows neither; once the width stops moving the rail is the pane's only content, and a rail already standing when a view remounts the sidebar is there from the first frame rather than fading in again.
Every Agent's list closes as the pane collapses, and expanding it again leaves them closed.
An expand draws the tree at once and lets the width follow it; a drag, a window with no room for a pane and a reader who asked for no motion all swap at once instead.
A click on a closed Agent's row opens that Agent's new-session page, as its avatar in the rail does, so its files, artifacts and changes are in the side panel before any Session starts, and opens its list, also one the user had closed; a click on an open Agent's row only closes its list and leaves the page where it is.
The chevron that replaces its avatar on hover or keyboard focus, and at all times on a device without hover, only opens and closes the list, without opening the page.
The Agent open in the page opens in the tree until its row closes it, and closes again when another Agent opens in the page, unless the user opened it; any other Agent opens and closes from its row, and the open state lasts until the page reloads; a page with no Agent open, such as Home, leaves every list as it was.
While the JanUI experiment is on (the saved preference decides until the flags load), each attention hint, which names its Agent, refreshes that Agent's own list and its single-Session lookups, and a sync (sent when the owner stream overflows or a tab subscribes again) refreshes them for every Agent in the cache, at most eight of these Session families at a time across all hints, a family already queued joining that pass, while the Agent list and other families refresh at once since a Session read waiting for its Agent to start ends only when the Agent list refreshes, so an open list and an old pin stay live without that Agent's chat, for Sessions outside the record window too.
A closed Agent row shows a mark for a waiting approval, or else for an unread Session, with a text equivalent, and its second line carries the time of the latest activity in any of its Sessions, not its state; its filter and actions buttons show on hover or keyboard focus, and at all times on a device without hover, and a right click on its row or on a Session row opens that row's actions menu at the pointer; a New session row always leads an open list, whatever it holds, and a New agent row always leads the Agent list, asking first which kind of Agent to make — the generalist Agent the row used to make on its own, or one built from a starter kit, which opens the kits — and the rail's New agent tile asks the same question beside the rail;
On an Agent's new-session page, that New session row is the current page, not the Agent row.
A Home row at the top of the tree opens the dashboard.
The row above it is a row like it, the chevron for its icon and the brand for its label, and the whole row collapses the pane; the brand itself leads nowhere, since Home is a row of its own.
An Agent's open list with every page read that lists no Session shows its New session row alone; a filter that hides them all says so below that row, and with more pages left says that no loaded Session matches and offers Load more.
An Agent's empty chat shows the Agent's avatar and name with no hover effect, and lists the ways into the Agent as on its General page: the CLI, editor and messenger rows open in place, from the pointer or the keyboard, and the opening does not animate under reduced motion.
The rows are a list of buttons, not an ARIA tree: Tab moves between them, and each Agent's chevron is a disclosure button after its row that names the list it opens.
An Agent's list slides open and closed in 200 ms, but not under reduced motion and not when it is already open as the page loads; a closing list leaves the Tab order at once.
Each Session row has an activity dot: orange for a waiting approval, a spinning blue ring while working, a green ring for background work, green for unread, a pen for a draft and gray when idle; unlike the current layout's blue unread dot, unread is green here; under the title the row leads with the time of its last activity, then any spend and a line naming its harness, model and source; a Session from the record alone has no model, and a terminal Session names no source, its terminal icon marking it instead.
A Session row's harness icon sits with its schedule, terminal and messenger icons at the row's top right, where the row's actions replace them on hover or keyboard focus; the context line then names no harness.
A row the tree shows away from its Agent, as in the Pinned section or the All sessions list, leads with its Agent's avatar under the activity dot, and names that Agent before the time.
A pinned row shows no pin mark, since its section says it is pinned; pinning and unpinning are actions of the row's menu, beside Rename and Delete.
The tree's Agents header carries one session filter, by state and by Session type: it narrows the Pinned section, the All sessions list, every Agent's list that has no filter of its own and the rail's Session tiles which the same filter reaches from the rail's own copy of the control, and the control shows a mark while a filter is on.
Each Agent row carries that Agent's own filter, the same one the current layout's Agent row sets: while it is on it replaces the header's filter for that Agent's list, and its control stays shown with a mark, alone at the row's right edge until the row's other buttons join it on hover or keyboard focus.
Beside it, a Group by menu offers All sessions or Group by agents, the tree; the choice lasts until the page reloads.
All sessions replaces the Agents with one list of the unpinned Sessions in the owner's attention record, newest activity first, each row led by its Agent's avatar and name, twenty at a time with Load more; a page starts after the last row the one before it returned, so the list reaches every Session the record holds rather than its newest 200, while a Session the record has dropped shows only under its Agent.
A filter narrows the pages already loaded, so while the filter an Agent's list applies is on, the list loads a further page only when the user clicks **Load more**; when a filter is removed, every Agent's list keeps its first page only.
The tree keeps the same manual Agent order, set by drag and drop or with Alt+Up and Alt+Down; an Agent's own list keeps the newest-first order.
A Session can be **pinned**: a pinned Session moves to a **Pinned** section above every Agent and leaves its Agent's list; pinning from the row's menu keeps focus on the moved row, or on its Agent's row when that Agent is closed or still closing, or, in the All sessions list, which shows no Agent rows, on the Group by control.
Pins are kept in the browser, so they do not follow the user to another device.
The Pinned section reads a pinned Session from the record, and one the record does not hold by its id from its Agent while that Agent can answer, seeded with the row it was pinned from so it shows at once, and offering a retry when its first lookup fails; the section orders all pins by latest activity; every pinned row has the same actions and spend as in its Agent's list; deleting a Session from the tree drops its pin, and a pin whose Session is gone otherwise shows nowhere but stays stored, since pins live only in the browser and no failed or stale list may count as proof that one is stale.
A pin of an asleep Agent that its record does not hold shows once the Agent wakes.
Opening an Agent's list wakes a hibernated Agent the same way, and a list left waiting on an Agent that stays asleep offers the same retry; the tree never reads an empty record as an empty list.
Until the record answers, and for an Agent that cannot answer for another reason, the list shows its loading placeholder; a list whose first page failed offers a retry instead of saying the Agent has no Sessions.
An Agent's chat drops its top bar and its column of Files, Artifacts and Processes sections for the side panel and its icon bar: Artifacts, Files, Changes, Browser and Processes become tabs of the panel, with Get started and Approvals below them and Documentation between the two while the Unified right toolbar experiment draws the bar, Changes is one only while the Agent has a git repository, and an Agent's chat also has an Environments tab while the `environments` feature is on and the Agent owns at least one Environment.
Home becomes a dashboard of cards built from the record, the Agents list and the owner's schedules, and a user with no Agent sees only the welcome introduction with Create agent and Start from a kit; its counts cover only the record's rows, at most the feed's row limit, so they describe recent work, not all time.

## The Unified right toolbar experiment

The **Unified right toolbar experiment** is an [experimental feature](features.md) of its own, independent of JanUI: it changes the right-hand icon bar and the top bar of the panel that bar opens, and leaves the rest of the shell to whichever layout the page uses.
With it off under JanUI, the right edge keeps the classic icon column, a 49 px bar of 48 px buttons under a 48 px panel header.
With it on, the bar is 56 px wide and draws one column of 40 px tiles 8 px from the top, spaced 14 px apart, with the same muted fill and hairline for the item the user is on, the same hover shade, the same 8 px squircles and the same accent focus outline as the sidebar rail.
Its tiles carry no tooltips: the accessible name stays on the button and the open panel's header names the tab.
A count badge keeps its place on the icon's top-right corner.
The panel's top bar becomes a 40 px row 8 px below the top of the panel, with its rule under it, ending in a 40 px X tile that closes the panel and hands the keyboard back to the rail; the tile sits centered in a square cell in the top bar's top-right corner, from the panel's top down to the bar's rule and from the cell's border to the panel's edge, in a docked item's top bar too, and the panel's other controls keep their size.
The bar scrolls when the window is too short to hold every tile, so the bottom of the rail stays reachable.
The tiled bar adds the Documentation tile, and it offers the Artifacts tab on every page whether or not JanUI is on: outside an Agent's chat that tab lists the whole library, except on an Agent's configuration page without JanUI, where it lists that Agent's artifacts as it already did.
The left navigation drops its own Artifacts entry and Documentation link while the bar offers both.
The rest of the rail's tab list and what each tab shows do not depend on this flag.
The right side is the flag's either way: an Agent's chat draws the rail too, with one tab of the panel at a time, instead of the classic column of Files, Artifacts and Processes sections, and the file, artifact, browser, changes or output it docks shows in the panel of the tab it belongs to.
The chat's own bar goes with that column, so a wide window reads as JanUI's chat does and nothing repeats the Agent's name; it comes back there only while the status has a badge to show.
A phone keeps that bar, carrying the navigation button, the running count and the buttons that open the panel, since the rail waits for a panel there.
JanUI decides only the shell around it: whether the navigation is the tree or the classic sidebar, whether a page outside a chat has a bar above it, and whether a narrow screen's overlay starts at the left rail or at the screen's edge — a page with no rail there shows the overlay at its own edge, with the rail inside the panel.
With the toolbar off, a chat without JanUI keeps its classic column of sections and opens the browser, changes and Get started from its top bar, and Approvals as a drawer over the chat.
While JanUI is on as well, the navigation counts the bar this flag draws when it decides whether the page has room for the pane.
With both experiments on, the page reads as one surface: the sidebar rail and the right rail draw the same tile.

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

The bell also lists the owner's [outage alerts](provider-status.md#outage-alerts): a provider outage that hits their Agents, with each Agent, why it is affected, and a way to switch its provider.
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
