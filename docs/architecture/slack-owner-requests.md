# Owner requests in Slack

Last verified: 2026-11-26

When an agent needs its owner's decision on a request nobody has allowed, the owner should be able to answer where the request was made.
This page owns how the three gates of [HITL ext_authz](security-and-credentials.md#hitl-ext_authz) decide between holding and refusing a request, how a held request reaches its owner, and how long it waits.

## Addressed Slack turns

An **addressed Slack turn** is a turn that a person's message started and that shows the working status: a mention, a message in a DM, a whisper thread in a DM, or the nudge after an undelivered reply to such a turn.
There, a person can end the wait with the "Don't wait" button on the thread's line, in every workspace, whether or not Slack shows its own Stop.
Ambient rounds, replies in an agent's own thread, a whisper sent with its message, and turns that a bot, an app or an agent started are not addressed: nobody there can end a wait, so their requests keep the refusal of [channel turns](channel-turns.md).

Turn attendance counts three things per agent, across api-server replicas: every open channel turn with its kind (Slack, Telegram or an artifact's viewer), the addressed Slack turns, and the Slack turns whose person pressed "Don't wait".
A press moves its turn from the addressed count to the released count, and the move is confirmed before the release goes out, so the agent's next request already finds the turn released.

## The shared decision

The network gate, the web-search gate and the MCP tool-call hold call one decision, after the agent's own rules and the sub-agent refusal.
It gives each request a verdict (hold or refuse) and a **route**, which says how the request reaches its owner:

1. an addressed Slack turn is open and the owner can get cards → hold, route `turn`;
2. a released Slack turn is open → refuse, route `background`, also while someone has the agent open, so a retry after "Don't wait" does not wait again;
3. a channel turn is open and nobody is attached → refuse, route `background`;
4. a web search of a scheduled session, and the owner cannot get cards → refuse, route `background`;
5. otherwise → hold, route `background`.

A channel turn with nobody attached refuses because nobody there can answer: the owner may be absent, and the conversation's other members are not the owner.
A refused request still files its approval for the owner, and records in which kind of conversation it was refused; retries join that one approval, and no in-session prompt goes out, because the clients that would read it are absent.
The attendance reads cover every api-server replica and fail toward attended, so losing them degrades to an ordinary hold rather than a silent denial.
An agent whose rules allow everything never reaches the decision, because nothing it requests is unmatched.
The gate cannot tell which session sent a network or MCP request, so while an addressed Slack turn runs, a schedule's request of the same agent also gets the `turn` route.

**The owner can get cards** when the owner has a Slack identity link in a workspace whose install is on record with an active credential, has not [turned the cards off](#turning-cards-off), and the operator has not turned the feature off ([configuration](../configuration.md)); otherwise every request behaves as before this feature.

## Route, raise and expiry

The route is stored on the approval and never lowered.
A `turn` request that joins a waiting `background` approval raises it to `turn` and moves its expiry to a full hold window from the join, and the raise is announced as an event.
A hold waits until its approval's expiry; when the expiry moved, the wait follows it, and an approval expires only once its expiry has passed.

## How long a request waits

A hold ends when the owner answers, when its client goes away (the gateway cancels the check, for Stop as for a tool that gives up), when a "Don't wait" release ends it, or when the approval expires.
In most cases the client decides first: an agent's fetch tool gives up after about a minute, a shell command after a few, and the egress gateway itself can end a quiet request sooner.
So nothing the owner or the person who asked reads promises a time.

Each routed approval counts the waits that still listen for its answer, with a lease per wait so a replica that dies drops out.
When the count leaves zero, or returns to zero without a verdict, an event says whether anyone waits; a verdict or an expiry is announced as resolved instead.

## Don't wait

A release is a message on the agent's release channel with the time its turn began and the turn's sessions.
It ends every `turn` wait of the agent that began after the turn did; a web search that names a session is released only when the turn ran on it.
Network and MCP requests carry no session, so a press in one thread also ends the current waits of another addressed thread of the same agent.
A released request was not denied: each gate answers it with a neutral refusal that says the wait was ended in Slack, and its approval stays pending for the owner until it expires.

## Approve once

An approve once lets every request that waits on the approval through.
For network and web search, every such request marks the approval used; when nobody waits, the next identical request within a hold window of the answer uses it, once.
An MCP approve once serves exactly one call, as before.

## What the agent reads

On an addressed Slack turn of an owner who can get cards, the turn's instructions say that such a request goes to the owner in Slack and waits while the tool waits, and that a request that ends without an answer was not denied: the agent finishes without the step and tells the person who asked that the thread will say when the owner allows it.
For an owner without a Slack link, the agent also says that the owner can answer such requests from Slack after linking with the login command; for an owner who turned the cards off, that the owner does not take such requests in Slack now.

## Cards

A routed request reaches its owner as a row of a **card** in the owner's direct message with the app, at once for a `turn` request and after a minute for a `background` one ([when background cards go out](#when-background-cards-go-out)), in every workspace where the owner can get cards; the card comes from the app with no agent persona, like the platform's other notices.
Each agent has at most one open **turn card** for its `turn` requests and one open **background card** for the rest, per workspace; a raise moves a request from the background card to the turn card.
A turn card names each thread it holds requests from and who started it, because it cannot tell which thread sent which request.
Rows that still wait come first, at most ten, then a count with "Open in app"; a row whose request nobody waits for any more says that the answer counts for the next try.
Agent-written text never reaches Slack as markup, and host, Connection and agent names come from the platform's own records.

Placing runs on the channels leader, one owner at a time, so requests that arrive together join one card.
The card is recorded before it is posted, so a post that failed can be posted later.
A join from a thread the turn card does not name yet, or a background row that starts to wait, posts the card again when the old post is more than five minutes old, so Slack notifies the owner once more; any other join edits the card silently.
A turn card that cannot be posted for a lasting reason, such as a missing scope or a direct message that cannot open, denies its waiting requests at once, so no thread waits for a card that never comes.
Every card post carries message metadata that marks it as a card: history reads drop such posts, and the app's own posts are never turns, so an agent bound to the owner's direct message never reads or answers a card.

## When background cards go out

A `turn` request gets its row at once, because a person waits in the thread.
A `background` request gets its row only when it still waits after 60 seconds and its owner is not active in the web UI: the sweep places it, so the row arrives one to one and a half minutes after the request, or at the first sweep after the owner stops using the web UI, while the request still waits.
This keeps an owner who works in the web UI from a Slack ping for a request they will answer there.

The server cannot tell who looks at an agent, because presence names the agent only, and a stale tab, an SSH session or an editor's browser write it too.
So the web UI tells the server about its own user: while its tab is visible and the keyboard, the mouse or touch was used in the last two minutes, it calls a mutation every 60 seconds that sets a per-owner Redis key with a 120-second life.
The owner counts as active for two to four minutes after the last input, and for up to two minutes after the tab is hidden; a read that fails counts as not active.
The call sends nothing else and shows nothing, and only a browser session, never an API key, can make it.

There is no cap on cards: an agent has at most one open background card, whose rows group by host, and each call card or question card needs its own answer.
When an agent was blocked on ten or more different hosts today, counted from its card rows, its background card says so, says that a rule for each host will not stop it, and links to the agent's network settings; it never suggests a rule for every host.

## Sub-agent questions and launch rules

A sub-agent's [question](invocations.md#asking-the-owner) gets a **question card** of its own, keyed to the asking run, under the timing of a `background` request: a minute after the question, while the owner is not active in the web UI, or at the first sweep after they stop.
It works like Claude's question UI: who asks under which Driver, the question, the options as a radio list with "Other", a text field, "Send answer", and until when it waits and which default the sub-agent takes then.
An option longer than Slack shows is cut on the card, and its index travels with it, so the answer is the full option.
A pick answers with that option, and "Other" or no pick with the text written; with neither, the owner gets a private hint and nothing changes.
The answer goes through the same delegation control as an answer in the Driver's chat, run as the owner, so each answer reaches its own sub-agent and the first answer counts; the Driver still has no way to answer.
When the question closes, by the owner here or in the chat, by its default at the deadline, or by a stop, the card says how and closes.

A network rule a Driver set at a one-off sub-agent's launch, which holds the sub-agent's task until the owner answers, is a row of the Driver's background card under the same timing: the rule in the platform's words, whether it is wider than the Driver's own rules, until when the sub-agent waits, and the web's verdicts for it.
Letting the Driver widen every later launch on its own stays in the app.
An agent's own rule proposal gets no row, because it holds nothing.

## The thread line

While an addressed Slack turn waits on a request, the app posts one line in its thread: the agent asked its owner, by display name and without a mention, to approve a step, with a "Don't wait" button.
It gives no time, and names no host, path or command.
When nobody waits on the agent's `turn` requests any more and one is still pending, the line says that the agent went on without the step and until when the owner can still approve it; a request that waits again turns it back.
Once every request it covered has settled, the line says that the wait ended.
An owner who sent the turn also gets a private note with a link to the card; in the owner's own direct message with the app, no line goes out.

Only the person who started the turn, a person whose message joined it, or the agent's owner may press "Don't wait", as with Stop; anyone else gets a private note.
A press first takes the turn out of the addressed count, so its later requests are refused at once, then sends the release.

## Answering in Slack

Only the owner answers in Slack: a click counts only when the clicking Slack user's identity link resolves to the request's owner, and anyone else gets a private note that only the owner can answer.
Editors answer in the web, and their answer shows on the card.
A click goes through the same approvals service as an answer in the web, run as the owner, so the first answer counts wherever it comes from; a click on a request that is already settled gets a private "Already answered".
Every click redraws the cards of the requests it answered from those requests, so a card shows the real outcome even where Slack shows no private note.
The verdict records the owner as who decided, and its audit line names the Slack user and workspace that clicked.
A click never posts a message, so a direct message bound to an Agent through the DM Bridge starts no turn from it.

A held MCP tool call shows as a row of the turn card, or as a **call card** of its own when it is a `background` request, so a call never waits behind blocked hosts: the agent, the tool and the Connection, the target the Template named, the arguments as a code block cut at about 2,500 characters, the expiry, and Allow once and Deny.
Allow once runs exactly one call; Deny refuses it.
Once settled, the row shows its outcome instead of its buttons.

## Network and web-search rows

On a turn card, each held network request or web search is a row of its own: the request without its query string, then the query string or the search as plain text cut at about 200 characters, because a query can carry data out.
While it waits, the row offers the web's verdicts in Slack's words: Allow once, Deny, "Always allow this path" when it has a real path, "Allow whole host" and "Always deny…"; a web search offers Allow once, Deny, "Always allow web search" and "Always deny web search…".
A turn card that names one thread and shows at least two waiting network or web-search rows also offers "Allow all once" and "Deny all", which answer those rows only; an MCP call keeps waiting for its own click.

On a background card, every network request to one host shares one row, and every web search shares another: "Blocked on <host>", its paths with their query strings while they wait (up to five, then how many more), how many times the agent was blocked there today, and the expiry of the newest waiting request.
Allow once and Deny answer every waiting request of the row.

A row whose request expired, or that the gate refused at once, is a **rule row**: it offers only the rule buttons, because nobody waits on it, and a refused row says where it was refused, such as "Refused at once in a Slack channel".
A rule verdict writes the same rule as the web, also on an expired request.
"Always deny…" writes the web's deny rule for each path of the row, and Slack asks to confirm it first; so does a rule that restarts the agent's network access, which the card checks against the agent's current rules when it is drawn.
A rule that clashes with an existing rule of the opposite verdict changes nothing, and the owner is sent to the app.

"Dismiss" denies the row's waiting requests once, shows "Dismissed for 7 days", and for seven days no background row goes out for that agent and host; its blocks still show on Home.
A Slack-turn request still gets its row, because a person waits on it.

## Card lifecycle

A card stays a true view of its requests to the end, whoever answers them and wherever.
Every settle of a routed request, from a verdict in the web, a click in Slack, an expiry or the refusal of an unreachable card, carries its route, and the channels leader settles the request's items on every card that holds them, under the owner's lock.
A click settles its own items first, as answered "by you"; any other settle reads "in the app by <name>", with the decider's display name, or "you" for the owner; an item already settled is left alone, so the two paths never edit a card twice.
A settled row shows its outcome line instead of its details: the arguments and the query string leave Slack.
An expired network or web-search row becomes a rule row and keeps its rule buttons.

When the owner allows a request that nobody waited for any more, the app posts one reply in each thread whose line says that the agent went on without the step, because Slack sends no notice for an edit: it mentions the people whose messages the turn carried and says when to ask again, the decision time plus the hold window for an approve once.
An allow while a request still waits, a deny and an expiry post no reply.
Each settled item writes one `owner_request.card_settled` log line: how and where it settled, whether its thread still waited or pressed "Don't wait", and the delay since the post, never the request's content.

A turn card with no waiting row is sealed: it takes no new rows, so the next Slack-turn request opens a new card.
It closes at once when none of its rows offers a rule, else 24 hours after its last change; a call card closes once its call settled, and a background card closes when nothing on it waits and its last change is 24 hours old.
An owner linked in several workspaces has a card in each, and every settle edits all of them.
`/dam logout` closes the owner's cards in that workspace with "Slack was unlinked: answer in the app"; their requests stay pending on Home.

A sweep on the channels leader every 30 seconds repairs what a lost event or a leader change missed: it posts a card row that has no post after a minute, places a waiting routed request that no open card holds, settles items whose request settled, applies the close rules, and deletes ended dismissals.
It reads only open cards and the routed requests of the last hold window, through an index on the route, so it never scans every approval.
A Slack error leaves an item as it was, and the sweep tries it again until its card closes.

## The approvals list

Cards are a push, and not every request gets one, so `/dam approvals` is the pull: it answers the caller alone, in any conversation, with every request that waits for them as an owner, the same set as the web's approvals list, carded or not.
A caller without a link is told to log in first, and an editor sees only the agents they own.
The list groups the requests by agent, newest first; a network host or the web searches of one agent are one entry, as on the background card.
A network, web-search, MCP tool-call, launch-rule or question entry carries the buttons or the form of its card, with the arguments and the question cut shorter; any other type shows its summary and "Open in app".
The fields of each question carry its run in their ids, so the fields of one question are read apart from another's.
The list stops before Slack's limit of 50 blocks and ends with how many more requests wait in the app.
A click in the list answers through the same path as a click on a card, so it edits the request's cards too, and then draws the list again in place through the click's own response URL; when that fails, a new private list goes out.
The command menu offers the list as "Your approvals".

## Turning cards off

`/dam approvals off` turns the owner's cards off, a choice kept per owner in the channels module's database.
The owner's reach then reads as muted, which the [shared decision](#the-shared-decision) treats like no link: a new Slack-turn request is refused at once, and no new card or row goes out.
A card whose request still waits stays until the request ends, so a held turn keeps its card; every other open card closes with "You turned cards off: answer in the app", and the sweep closes the rest once nothing on them waits.
`/dam approvals on` turns the cards back on, and the list works either way.
Each writes one log line, `owner_request.cards_off` or `owner_request.cards_on`, which gives the share of owners who turn cards off.
