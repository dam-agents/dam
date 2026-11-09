# Assistant

Last verified: 2026-11-09

## Overview

The **assistant** is the one Agent the platform gives each person for themselves, once: it appears in their agent list and their sidebar like any other Agent, has its own avatar, chat, sessions, schedules, skills, providers and model, and it is the first thing they land in while it has never been used.
It is not a second kind of Agent — it is an [Agent](agent-lifecycle.md), created through the ordinary create, so everything on [agent-lifecycle](agent-lifecycle.md), [sessions](sessions.md), [agent-editors](agent-editors.md), [channels](channels.md) and [agent-avatars](agent-avatars.md) applies to it unchanged: its owner may rename it, change its model and provider, disable it, give it editors, bind it to a Slack or Telegram conversation, and delete it.
What makes it different is who creates it, that this happens once, and the greeting its first chat opens with.

Its name is the install's, not the code's: it comes from the brand (`brand.assistantName`, `Dambledore` in the chart) and reaches the api-server and the UI the way every other brand value does ([platform-topology](platform-topology.md)).
The name is **not reserved**: an owner who already has an Agent by that name keeps it, and the assistant takes the next free name after it, so no request ever renames somebody's Agent.

## Provisioning

The install decides whether people get one at all through the `dambledore` [feature](features.md) mode, which follows the chart's `featureDefault` like every other feature and is named only when an install wants another answer: `off` gives nobody one, `experimental` gives one to whoever switches the flag on in Settings › Experimental features, and `on` to everyone.
Until a person has it on, nothing of theirs exists: no record, no Agent, no provisioning.
Turning the mode or the flag off later deletes nothing — the Agent stays in their list, theirs to use and to delete — and only hides the greeting, the landing and the reset ([where it appears](#where-it-appears)).

Provisioning is **lazy**, at the first authenticated request the install admits — the same moment the [Getting Started](getting-started.md) checklist first meets them — and again after they accept the Terms of Use or switch the flag on, since neither makes a new request context.
A person who has not accepted the Terms of Use, or whose acceptance a closed sign-up refuses, gets nothing.
No batch job provisions dormant accounts: an install of any age gives each person their assistant the next time they sign in.
A request made with an API key or with an Agent's own credentials is not a person arriving, so it provisions nothing.

It is created **once**, and a tiny per-owner record is what makes it so.
The record names the Agent and is written *before* the Agent exists, settled by its primary key: concurrent requests make one Agent between them, and the ones that lose find the owner taken and stop.
It also says whether that Agent is there yet, so a create that dies half-way is finished by the next request — which asks the store for the same Agent, whose own create settles it — while a finished one is left alone by every later request.
If the person deletes the Agent, the record stays, so **nothing recreates it on a request**: [resetting their onboarding](#starting-it-over) is the only thing that makes a new one.

The Agent is made through the ordinary create, on the owner's [default for new agents](profiles.md#the-default-for-new-agents), with ordinary hibernation and on the owner's budget.
An install with no [CurveBender](platform-topology.md) still creates it: the composer's own provider notice explains what to connect, which is the same answer every other Agent gives.
Its `~/AGENTS.md` is written at that create, in place of the template every other Agent starts with ([the first chat](#the-first-chat)); an owner's edits to it afterwards stand.

**Ordering with the checklist.** The checklist decides once, at first meeting, whether a person used the platform before the checklist existed (`Create` in [getting-started](getting-started.md)).
That decision reads the Agents a person already owns, so provisioning enrols them *before* it creates the assistant; the assistant is then what makes their first checklist task done rather than evidence they were here before.
That task is recorded as seen, since the person did not make this Agent by hand: the checklist counts it at once rather than holding a celebration for it.

## What its owner may do

Everything.
The assistant carries no reserved Permissions, no blocked operations and no special standing for Agent Editors: it is the owner's Agent, and [Agent Editors](agent-editors.md), Agent Permissions and the UI's controls are the ones any Agent has.
The platform never acts on it alone either: an install never deletes a person's assistant, and turning the feature off leaves the Agent where it is.

## Where it appears

The record is the only thing that identifies it: the UI learns which Agent it is from the api-server and treats it as the assistant by that identity, so an Agent renamed, disabled, asleep or copied keeps being recognised.
A person whose assistant has never been used lands in its chat rather than on Home; once it has been used, Home is where they land again.
That answer is the record's own mark, set by the first Session that began after the person's last onboarding reset — and only while the install offers assistants — so an asleep assistant is decided without waking it, and an install that offers none writes nothing.
A Session that began before the reset does not count however late it is reported: a runtime that boots re-reports the Sessions it already had, and those are no use of a first-timer's assistant.
Setting the mark is announced to the owner's open tabs, since a Session started in another tab, or a turn from a Slack or Telegram conversation, marks the assistant used without this tab having sent anything.
The UI asks the server for the record only for someone the feature is on for.

## The first chat

While the assistant has had no Session, its chat opens with a **greeting** rather than an empty transcript: the assistant's avatar and name, `Hi <given name>! I'm <assistant name>, your new personal <brand> agent!`, and the ask to hear about the owner's role.
The code writes none of those names: the given name is the signed-in person's `given_name` claim (no claim, no name — `Hi!`), and the assistant's and the brand's names come from the brand, so an install renames itself without a UI change.
The text lives once, in `api-server-api`, because two readers need it: the UI that renders the greeting and the agent that must know it wrote it.

Under the message it offers a few **first tasks** — `Explain what you can do`, `Draft a weekly status template`, `Summarize a long text I paste`, `Remember I like answers short and technical` — each one needing neither a connection nor any personal context, and the composer's empty placeholder shows the last of them.
A click puts the task's text in the composer and sends nothing: no turn, no model call, no token is spent until the person acts.

Everything here is behind the `dambledore` feature and the record's own mark: the greeting is shown while the record says the assistant is unused, and it is that mark alone — not the count of Sessions the Agent holds — that decides, so an empty chat shows it again after a reset even though older Sessions exist.
The session report lags the Session that just started, so the chat needs the Agent's own answer too, and a Session appearing there sets the cached mark at once, which is why a New chat after the first message does not bring the greeting back.
A Session appearing sets the cached mark at once, so a New chat after the first message does not bring the greeting back.
Until both answers are in, the chat shows neither the greeting nor the ordinary new-chat page — a blank rather than a page that would be taken back a moment later.
A person the feature is off for, and any other Agent, open on the ordinary new-chat page with the ordinary placeholder.

**What the agent receives.** The platform opened the conversation, so the assistant is told what it said: its `~/AGENTS.md` carries the greeting it opens with, the first tasks it offers, and what to do about them — learn the person's role and work while it does not know them, say what it could do for them, and remember what they share.
The instructions carry no name of the person: the given name stays the UI's, and the file describes the greeting as the platform fills it in.
Nothing runs on the person's behalf: there is no `initialization` Session and no platform-composed first turn, because either would run the model before the owner asked anything, and the greeting itself costs no tokens at all.

## Starting it over

Experimental features carries **Reset user onboarding** under the assistant's own row, offered whenever the feature is on for the person — an install that pins it `on` shows no switch for them to flip, so only that row goes and the reset stays.
It is the person's own reset, scoped to the caller: it forgets that their assistant was ever used and starts the [Getting Started](getting-started.md) checklist over through the checklist's own reset.
Nothing is deleted — not the assistant, its sessions or its files.
An assistant the person **deleted** is created again by the same reset, as a new ordinary Agent on the same terms as the first, and the record points at it: there is always something to greet them with.
Only an Agent that the record says was there and is gone was deleted, and only that one is replaced: a create that is still in flight is adopted as it is, so a reset that meets the first request — or another reset — leaves one Agent rather than making a second.
The comparison that picks the Agent to replace is a compare-and-set on the record, and every path asks the store to create the one Agent the record names, whose create settles which of them makes it.

The checklist it starts over is a first-timer's from the first moment: the assistant's own `Create` task is recorded again the way provisioning records it — done, and seen, so nothing celebrates an Agent nobody made — which is one task of eight rather than an empty checklist.

What it restores is the first open: the record says the assistant has never been used, so the greeting returns to an empty chat and the first landing routes the person into it again.
The UI does not build that route itself — it fetches the record, the feature flags and the checklist again, releases the one-shot landing, and goes to the app's entry route, so the same landing logic decides, on fresh answers rather than the ones the cache held before the reset.
The greeting rests on that mark alone, not on how many sessions the assistant holds, so an empty chat shows it even when older sessions exist; sending a message marks the assistant used and takes it away again.

## Boundaries

Its owner's other Agents are not visible to it, it holds no platform tools, and it is never proactive: it knows what any Agent knows, with the access any Agent has.
Anything it should know later — a team knowledge base, the state of the owner's other Agents, cost and failure explanations, a way to drive the platform itself — arrives as a grant or a capability, without changing provisioning or this page's guarantees.
