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
