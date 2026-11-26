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

**The owner can get cards** when the owner has a Slack identity link in a workspace whose install is on record with an active credential, and the operator has not turned the feature off ([configuration](../configuration.md)); otherwise every request behaves as before this feature.

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
For an owner without a Slack link, the agent also says that the owner can answer such requests from Slack after linking with the login command.

## Cards

A routed request reaches its owner as a row of a **card** in the owner's direct message with the app, in every workspace where the owner can get cards; the card comes from the app with no agent persona, like the platform's other notices.
Each agent has at most one open **turn card** for its `turn` requests and one open **background card** for the rest, per workspace; a raise moves a request from the background card to the turn card.
A turn card names each thread it holds requests from and who started it, because it cannot tell which thread sent which request.
Rows that still wait come first, at most ten, then a count with "Open in app"; a row whose request nobody waits for any more says that the answer counts for the next try.
Agent-written text never reaches Slack as markup, and host, Connection and agent names come from the platform's own records.

Placing runs on the channels leader, one owner at a time, so requests that arrive together join one card.
The card is recorded before it is posted, so a post that failed can be posted later.
A join from a thread the turn card does not name yet, or a background row that starts to wait, posts the card again when the old post is more than five minutes old, so Slack notifies the owner once more; any other join edits the card silently.
A turn card that cannot be posted for a lasting reason, such as a missing scope or a direct message that cannot open, denies its waiting requests at once, so no thread waits for a card that never comes.
Every card post carries message metadata that marks it as a card: history reads drop such posts, and the app's own posts are never turns, so an agent bound to the owner's direct message never reads or answers a card.

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
