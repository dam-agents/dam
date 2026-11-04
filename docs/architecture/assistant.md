# Assistant

Last verified: 2026-11-02

## Overview

The **assistant** is the one Agent the platform gives each person for themselves: it appears in their agent list and their sidebar like any other Agent, has its own avatar, chat, sessions, schedules and skills, and is the first thing they land in while it has never been used.
It is not a second kind of Agent — it is an [Agent](agent-lifecycle.md) with the `assistant` **Agent Kind**, so everything on [agent-lifecycle](agent-lifecycle.md), [sessions](sessions.md) and [channels](channels.md) applies unless this page says otherwise.
What makes it different is who provisions it, what it cannot become, and the name it holds.

The name is the install's, not the code's: it comes from the brand (`brand.assistantName`, defaulting to `Dambledore`) and reaches the api-server and the UI the way every other brand value does ([platform-topology](platform-topology.md)).
The name is **reserved**: no other Agent may be created or renamed to it, and the assistant itself cannot be renamed, so the one Agent a person is given is always recognisable by name.

## Provisioning

The install decides whether people get one at all through the `assistant` [feature](features.md) mode: `off` provisions nothing, `experimental` provisions for whoever switches the flag on, and `on` for everyone.
Switching the mode off later stops provisioning and leaves the existing assistants where they are.

Provisioning is **lazy and idempotent**, at a person's first authenticated request — the same moment the [Getting Started](getting-started.md) checklist first meets them: the api-server asks whether the caller already has one, and creates it if not.
A row per owner is the record and the lock: it names the assistant's Agent, and provisioning for one owner runs under a per-owner advisory lock, so two tabs signing in at once still produce one Agent.
The row is emptied when its Agent is deleted, and a row whose Agent is missing — an operator deleted it, a create failed — is filled again at the next request.
No batch job provisions dormant accounts: an install of any age gives each person their assistant the next time they sign in.

An assistant runs on the owner's [default for new agents](profiles.md#the-default-for-new-agents), at the install's smallest size, with ordinary hibernation and on the owner's budget.
An install with no [CurveBender](platform-topology.md) still creates it: the composer's own provider notice explains what to connect, which is the same answer every other Agent gives.

**Ordering with the checklist.** The checklist decides once, at first meeting, whether a person used the platform before the checklist existed (`Create` in [getting-started](getting-started.md)).
That decision reads the Agents a person already owns, so provisioning enrols them *before* it creates the assistant; the assistant is then what makes their first checklist task done rather than evidence they were here before.

**A name already taken.** A person who already owns an Agent under the reserved name is not refused their assistant: that Agent is renamed once, to the reserved name marked `(yours)` and a number when that is taken too, and the news is written on the row as a one-time notice the UI shows on [Home](home-feed.md) until it is dismissed.
Both the rename and the notice happen inside the same per-owner lock as the create, so it happens once per person and never to the assistant.

## What its owner may not do

Agent Permissions are per role *and* kind ([agent-editors](agent-editors.md)): the assistant's owner holds every permission except the four that would make it something other than the person's own constant companion.
Those four are enforced in the api-server's permission layer, so the UI, the CLI and any Agent driving the platform API are refused by the same check with the same message, which names the assistant:

- **delete** — it cannot be deleted; the platform recreates it anyway.
- **editors** — nobody else can be named to work on it; its platform access is its owner's own.
- **disable** — it cannot be turned off.
- **binding to a channel** — it cannot be added to a Slack or Telegram conversation.

Everything else is the owner's, exactly as for any Agent: model and provider, sleep and wake, restart, image upgrade, skills, schedules, connections, environment variables, egress rules, spend limits, chat forms, terminal, avatar, whispers, and the owner's own Slack account connection.
Channel *binding* rather than channels as a whole is refused, so the assistant keeps whispers, keeps its Slack account connection and can still disconnect a binding it should never have.

The UI reads the same permissions: no Delete in its Manage list, no Disable, no People section, and its Channels section explains why there is no Connect control.
Its name is shown rather than edited.
That is presentation on top of the server's refusal, never a substitute for it.

## Where it appears

The assistant is visible in the agent list like any other Agent, and nothing hides it from lists or from the API.
A person whose assistant has no sessions yet lands in its chat rather than on Home; once it has a session, Home is where they land again.
Its first message, and anything it knows beyond what every Agent knows, is not part of this subsystem.

## Boundaries

Its owner's other Agents are not visible to it, it holds no platform tools, and it is never proactive: it knows what any Agent knows, with the access any Agent has.
Anything it should know later — a team knowledge base, the state of the owner's other Agents, cost and failure explanations — arrives as a grant or a capability, without changing provisioning or the blocked operations above.
