# Assistant

Last verified: 2026-11-04

## Overview

The **assistant** is the one Agent the platform gives each person for themselves: it appears in their agent list and their sidebar like any other Agent, has its own avatar, chat, sessions, schedules and skills, and is the first thing they land in while it has never been used.
It is not a second kind of Agent — it is an [Agent](agent-lifecycle.md) with the `assistant` **Agent Kind**, so everything on [agent-lifecycle](agent-lifecycle.md), [sessions](sessions.md) and [channels](channels.md) applies unless this page says otherwise.
What makes it different is who provisions it, what it cannot become, and the name it holds.

The name is the install's, not the code's: it comes from the brand (`brand.assistantName`, defaulting to `Dambledore`) and reaches the api-server and the UI the way every other brand value does ([platform-topology](platform-topology.md)).
The name is **reserved**: no other Agent may be created or renamed to it, and the assistant itself cannot be renamed, so the one Agent a person is given is always recognisable by name.

## Provisioning

The install decides whether people get one at all through the `assistant` [feature](features.md) mode, which follows the chart's `featureDefault` like every other feature and is named only when an install wants another answer: `off` provisions nothing, `experimental` provisions for whoever switches the flag on in Settings › Experimental features, and `on` for everyone.
Until a person switches it on, nothing of theirs exists: no record, no Agent, and no rename for an Agent that already holds the reserved name.
Switching the mode off later stops provisioning and leaves the existing assistants where they are.
The UI asks the server for the assistant's record only for someone it is on for, and lands nobody in its chat otherwise, so an install that offers it experimentally costs a person who never opts in nothing.
An install whose mode is off decides on the mode alone: no stored flag, no assistant record and no Agent is read, the UI does not ask for the assistant's state, and a Session report writes nothing.

Provisioning is **lazy**, at a person's first authenticated request the install admits — the same moment the [Getting Started](getting-started.md) checklist first meets them — and again after they accept the Terms of Use or switch the flag on, since neither makes a new request context.
A person who has not accepted the Terms of Use, or whose acceptance a closed sign-up refuses, gets nothing: the admission is read before anything is created.
No batch job provisions dormant accounts: an install of any age gives each person their assistant the next time they sign in.

Provisioning is **an idempotent ensure over a durable record**.
One row per owner names the incarnation of its assistant, and the Agent's id is derived from the owner and that number: every replica computes the same id, so the store's own uniqueness is what makes one Agent — a create that loses is refused and its caller adopts what is there.
Nothing waits and nothing is fenced: there is no claim to take over and no lease to expire.
When the Agent is deleted after it was ready, the row moves to its next incarnation, so the replacement has a **new id**: nothing still keyed by the old one — an artifacts sweep, an outbox entry — can reach it.
The row records `ready` only after the Agent and every initialization step behind it returned, so a request that dies half-way leaves a record the next request finishes; a step that fails is logged, recorded as not ready, and retried on the next one.
The row records each initialization step as it lands — the environment variables, the trusted egress preset, the instructions in `~/AGENTS.md` and the first providers — and a retry applies only the ones it has not recorded.
A row that is already `ready` catches up the same way when a later version defines a step it never ran: only the missing ones are applied, each recorded as it lands, and an Agent that was announced when it became ready is not announced again.
Nothing is re-applied "if absent", because an empty set is exactly what an owner leaves behind by choosing no network access or detaching every provider: that choice stands, and the chat default is left alone when the Agent has one.
A preset the owner emptied is not even re-seeded when a step's record was lost before it was written: the rows a preset revokes stay behind, and their presence is what says the step ran.
An Agent recovered this way is announced once, when it first becomes ready, so the checklist and the live hints learn of it exactly once.

One owner's provisioning runs under **that owner's advisory lock**, taken on a connection of its own so the shared pool never waits on the holder; a request that finds the lock taken leaves the work to whoever holds it.
A worker paused while holding the lock blocks only that owner's provisioning, and only until its connection drops.

An assistant runs on the owner's [default for new agents](profiles.md#the-default-for-new-agents), at the size that default gives every new Agent, with ordinary hibernation and on the owner's budget.
An install with no [CurveBender](platform-topology.md) still creates it: the composer's own provider notice explains what to connect, which is the same answer every other Agent gives.

**Ordering with the checklist.** The checklist decides once, at first meeting, whether a person used the platform before the checklist existed (`Create` in [getting-started](getting-started.md)).
That decision reads the Agents a person already owns, so provisioning enrols them *before* it creates the assistant; the assistant is then what makes their first checklist task done rather than evidence they were here before.
That task is recorded as seen, since the person did not make this Agent by hand: the checklist counts it at once rather than holding a celebration for it.

**A name already taken.** A person who already owns an Agent under the reserved name is not refused their assistant: that Agent is renamed once, to the reserved name marked `(yours)` and a number when that is taken too, and the news is written on the row as a one-time notice the UI shows on [Home](home-feed.md) until it is dismissed.
The news is recorded before the rename happens, as pending, and completed only once the Agent carries its new name — a create that fails afterwards cannot lose it, and the notice waits for the rename to land.
A retry finishes a rename the record still describes, and drops the record when the person renamed that Agent themselves since.
It never touches the assistant.

## What its owner may not do

Agent Permissions are per role *and* kind ([agent-editors](agent-editors.md)): nobody holds the four that would make the assistant something other than the person's own constant companion — not its owner, and not an editor, whose standing on an assistant is refused outright.
Those four are enforced in the api-server's permission layer, so the UI, the CLI and any Agent driving the platform API are refused by the same check with the same message, which names the assistant:

- **delete** — it cannot be deleted; the platform recreates it anyway.
- **editors** — nobody else can be named to work on it; its platform access is its owner's own.
- **disable** — it cannot be turned off.
- **binding to a channel** — it cannot be added to a Slack or Telegram conversation.

Everything else is the owner's, exactly as for any Agent: model and provider, sleep and wake, restart, image upgrade, skills, schedules, connections, environment variables, egress rules, spend limits, chat forms, terminal, avatar, and whispers.
Binding is what is refused, not messaging as a whole: connecting the assistant to a Slack or Telegram conversation is refused, and linking the person's own Slack account — what `/dam login` does — is a separate operation that stays available.
The UI reads the same permissions: no Delete in its Manage list, no Disable, no People section, no control that adds the assistant to a conversation, and its Channels section says why.
A conversation it was already bound to is still listed and can still be released, which needs no refused permission.
Its name is shown rather than edited.
That is presentation on top of the server's refusal, never a substitute for it.

## Where it appears

The assistant is visible in the agent list like any other Agent, and nothing hides it from lists or from the API.
A person whose assistant has never been used lands in its chat rather than on Home; once it has been used, Home is where they land again.
That answer is the row's own mark, set when the first Session is reported — and only while the install offers assistants — so a sleeping assistant is decided without waking it and an install that offers none writes nothing.

## The first chat

While the assistant has had no Session, its chat opens with a **greeting** rather than an empty transcript: the assistant's avatar and name, `Hi <given name>! I'm <assistant name>, your new personal <brand> agent!`, and the ask to hear about the owner's role.
The code writes none of those names: the given name is the signed-in person's `given_name` claim (no claim, no name — `Hi!`), and the assistant's and the brand's names come from the brand, so an install renames itself without a UI change.
The text lives once, in `api-server-api`, because two readers need it: the UI that renders the greeting and the assistant that must know it wrote it.

Under the message it offers a few **first tasks** — `Explain what you can do`, `Draft a weekly status template`, `Summarize a long text I paste`, `Remember I like answers short and technical` — each one needing neither a connection nor any personal context, and the composer's empty placeholder shows the last of them.
A click puts the task's text in the composer and sends nothing: no turn, no model call, no token is spent until the person acts.

Everything here is behind the `assistant` feature and the row's own `used` mark, and it needs the Agent's own answer too: the greeting is shown only while the row says the assistant is unused **and** the Agent lists no Session, since the mark follows the session report and lags the Session that just started.
A Session appearing sets the cached mark at once, so a New chat after the first message does not bring the greeting back.
Until both answers are in, the chat shows neither the greeting nor the ordinary new-chat page — a blank rather than a page that would be taken back a moment later.
A person the feature is off for, and any other Agent, open on the ordinary new-chat page with the ordinary placeholder.

**What the agent receives.** The platform opened the conversation, so the assistant is told what it said: its `~/AGENTS.md` carries the greeting it opens with, the first tasks it offers, and what to do about them — learn the person's role and work while it does not know them, say what it could do for them, and remember what they share.
That file is written once, as one more **initialization step** of provisioning ([agent-lifecycle](agent-lifecycle.md)): the step is recorded as it lands, so a retry never writes it again and an owner's own edits afterwards stand.
The instructions carry no name of the person: the given name stays the UI's, and the file describes the greeting as the platform fills it in.
Nothing runs on the person's behalf: there is no `initialization` Session and no platform-composed first turn, because either would run the model before the owner asked anything, and the greeting itself costs no tokens at all.

## Rolling it out

Those refusals rest on the kind, and a replica older than this page reads an unknown kind as no kind at all: it would let the assistant be deleted, renamed, disabled, shared or bound like any Agent.
The mode therefore stays `off` until every replica runs a version that knows the kind.
Rolling back below that version withdraws the protections, not the Agents: the assistants stay, unprotected, until a newer version returns — and because an editor's standing on an assistant is refused outright, an editor row that predates the rollback grants nothing when the protections come back.

## Boundaries

Its owner's other Agents are not visible to it, it holds no platform tools, and it is never proactive: it knows what any Agent knows, with the access any Agent has.
Anything it should know later — a team knowledge base, the state of the owner's other Agents, cost and failure explanations — arrives as a grant or a capability, without changing provisioning or the blocked operations above.
