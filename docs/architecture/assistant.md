# Assistant

Last verified: 2026-11-12

## Overview

The **assistant** is the Agent the platform gives a person under its own brand's assistant name: it appears in their agent list and their sidebar like any other Agent, has its own avatar, chat, sessions, schedules, skills, providers and model, and it is the first thing they land in while it has never been used.
It is not a second kind of Agent — it is an [Agent](agent-lifecycle.md), created through the ordinary create, so everything on [agent-lifecycle](agent-lifecycle.md), [sessions](sessions.md), [agent-editors](agent-editors.md), [channels](channels.md) and [agent-avatars](agent-avatars.md) applies to it unchanged: its owner may rename it, change its model and provider, give it editors, bind it to a Slack or Telegram conversation, and delete it.
What makes it different is who creates it, and the greeting its first chat opens with.

Its name is the install's, not the code's: it comes from the brand (`brand.assistantName`, `Dammy` in the chart) and reaches the api-server and the UI the way every other brand value does ([platform-topology](platform-topology.md)).
The platform makes the Agent, and the record says which one it is: everything that treats it as the assistant — the greeting, the landing, the reset — speaks about the Agent the record names, not about a name in a list.
The name still belongs to whoever holds it: an Agent of the person's already called that, matched exactly and case-sensitively, is why nothing is made, and no request ever renames an Agent to free the name or makes a numbered second one.
An Agent they made under the name is never adopted as the assistant either — it is theirs, without the greeting or the standing instructions the platform writes.

## Provisioning

The install decides whether people get one at all through the `dambledore` [feature](features.md), which follows the chart's `featureDefault` like every other feature and is named only when an install wants another answer: `off` gives nobody one, `experimental` leaves the person's switch, and `on` gives one to everyone.
It is the one feature **on by default** (rollout, 2026-11-10): in `experimental` a person who has stored no choice gets one, and their switch in Settings › Experimental features turns it off.
So an existing account gets one at its next request, as a new one does — the switch is the way to decline, not to ask.
Until a person has it on, nothing of theirs exists: no record, no Agent, no provisioning.
Turning the mode or the flag off later deletes nothing — the Agent stays in their list, theirs to use and to delete — and only hides the greeting, the landing and the reset ([where it appears](#where-it-appears)).

Where the switch is the ask, **the switch is the trigger**: turning the feature on makes Dammy for a person who has none, and a create that fails is reported to them with the switch left off, because the switch is the one place a failure has a person to tell.
Deleting the platform's Agent and turning the feature off and on again gives them a new one; renaming it does not, since the record still names it and it is still theirs.
An install that pins the feature `on` has no switch to offer, so it gives each person theirs at their first authenticated request the install admits — the same moment the [Getting Started](getting-started.md) checklist first meets them — and again after they accept the Terms of Use, since neither makes a new request context.
A person who has not accepted the Terms of Use, or whose acceptance a closed sign-up refuses, gets nothing.
A request made with an API key or with an Agent's own credentials is not a person arriving, so it creates nothing.

No batch job provisions dormant accounts: an install of any age gives each person theirs the next time they sign in.

A tiny per-owner **record** is what makes that request-time create happen once: it names the Agent the platform made, and it is what says the person was already given one, so an install that pins the feature on never undoes a delete on the next page load.
Its cost is deliberate: an install pinned `off` reads nothing at all, and one that offers the feature pays the flags and one primary-key read of the record on every authenticated request, for a person who never wanted an assistant as much as for one who did.
The ceiling is that read per request; the upgrade path is a per-replica cache of the settled answer, dropped on the owner's own writes.
The record is written *before* the Agent exists, settled by its primary key, and its compare-and-set on the Agent it names settles a later create — so concurrent callers of any of the three doors make one Agent between them, and a caller that loses the claim waits for the winner's Agent rather than making a second.
Once the Agent is there, the record is marked ready, and a write that names a different Agent also starts the onboarding over on it.
A claim nobody finished is a create that died: the next request finishes it, asking the store for the same Agent, and a reset waits a bounded while for one that is still alive before finishing it.

The Agent is made through the ordinary create, on the owner's [default for new agents](profiles.md#the-default-for-new-agents), with ordinary hibernation and on the owner's budget.
An install with no [CurveBender](platform-topology.md) still creates it: the composer's own provider notice explains what to connect, which is the same answer every other Agent gives.
Its `~/AGENTS.md` is written at that create, in place of the template every other Agent starts with ([the first chat](#the-first-chat)); an owner's edits to it afterwards stand.

**Ordering with the checklist.** The checklist decides once, at first meeting, whether a person used the platform before the checklist existed (`Create` in [getting-started](getting-started.md)).
That decision reads the Agents a person already owns, so provisioning enrols them *before* it creates the assistant; the assistant is then what makes their first checklist task done rather than evidence they were here before.
That task's avatar is recorded unlocked and unseen, since the person did not make this Agent by hand: the first chat plays its celebration, and marking it seen from there is what finishes the task, so nothing celebrates an Agent nobody made.
An owner whose avatars are all seen has no avatar left to unlock, so nothing celebrates — the design's unlock is the first avatar, not this one.

## What its owner may do

Everything.
The assistant carries no reserved Permissions, no blocked operations and no special standing for Agent Editors: it is the owner's Agent, and [Agent Editors](agent-editors.md), Agent Permissions and the UI's controls are the ones any Agent has.
The platform never acts on it alone either: an install never deletes a person's assistant, and turning the feature off leaves the Agent where it is.

## Where it appears

The record is the only thing that identifies it: the UI learns which Agent it is from the api-server and treats it as the assistant by that identity, so an Agent renamed, asleep or copied keeps being recognised.
A person whose assistant has never been used lands in its chat rather than on Home; once it has been used, Home is where they land again.
That answer is the record's own mark, set by the first Session that began after the person's last onboarding reset — and only while the install offers assistants — so an asleep assistant is decided without waking it, and an install that offers none writes nothing.
A Session that began before the reset does not count however late it is reported: a runtime that boots re-reports the Sessions it already had, and those are no use of a first-timer's assistant.
Setting the mark is announced to the owner's open tabs, since a Session started in another tab, or a turn from a Slack or Telegram conversation, marks the assistant used without this tab having sent anything.
A tab also keeps its own mark for a Session it just started, before the report lands, and that mark belongs to one onboarding: the reset's moment is part of the record, so a reset — the person's own, or another tab's — takes the mark away with it rather than leaving a tab that never greets them again.
The UI asks the server for the record whoever the person is, not only for someone the feature is on for: which Agent is the assistant is what a chat needs to know, even after the feature is turned off, and a person without one costs an answer of nothing.
The [CurveBender notice](connection-presets.md#deployment-preset-curvebender) never shows in the assistant's own chat, and an account that was onboarded with the assistant — one that had no Agent of its own before the platform made it this one — never sees it anywhere, since its first chat is already set up on the shared Connection.
That cohort is **decided once and written on the record** when the platform first makes the assistant, and never recomputed: deleting the assistant, making a new one or deleting the last older Agent leaves an account in the cohort it was in, so the notice's audience cannot move under it.

## The first chat

While the assistant has had no Session, its chat opens with a **greeting** rather than an empty transcript: the assistant's avatar and name, `Hi <given name>! I'm <assistant name>, your personal <brand> agent.`, the model provider it is set up with — CurveBender's sentence when that is what it runs on, and otherwise where the person changes it — and a line saying it learns how they work, one task at a time.
The code writes none of those names: the given name is the signed-in person's `given_name` claim (no claim, no name — `Hi!`), and the assistant's and the brand's names come from the brand, so an install renames itself without a UI change.
The text lives once, in `api-server-api`, because two readers need it: the UI that renders the greeting and the agent that must know it wrote it.

Under the message it offers five **ideas**, each labelled with the kind of work it is — Artifact, Schedule, Knowledge base, Skill, and a question about the install itself — and a click fills the composer for the person to send or edit, so nothing runs before they act.
A click puts the task's text in the composer and sends nothing: no turn, no model call, no token is spent until the person acts.
The ideas outlive the greeting: every new chat of the assistant's own shows them under *Send a message to begin.*, in place of the row of ways to open the agent elsewhere, since the greeting's words are said once but a person starts a task on many days.

Everything here is behind the `dambledore` feature and the record's own mark: the greeting is shown while the record says the assistant is unused, and it is that mark alone — not the count of Sessions the Agent holds — that decides, so an empty chat shows it again after a reset even though older Sessions exist.
The session report lags the Session that just started, so the chat needs the Agent's own answer too, and a Session appearing there sets the cached mark at once, which is why a New chat after the first message does not bring the greeting back.
Until both answers are in, the chat shows neither the greeting nor the ordinary new-chat page — a blank rather than a page that would be taken back a moment later.
A person the feature is off for, and any other Agent, open on the ordinary new-chat page with the ordinary placeholder.

**What the agent receives.** The platform opened the conversation, so the assistant is told what it said: its `~/AGENTS.md` carries the greeting it opens with, the ideas it offers, and what to do about them — learn how the person works one task at a time, say what it could do for them, and remember what they tell it.
It also carries the **onboarding rules** that take a picked idea to a first result: one small sample of the person's own work, at most three questions before the result, a default it names rather than a question, nothing to connect, and what it learned shown before it is saved.
The same rules are a personal-assistant-only section of the `dam` skill, which an upgrade rewrites; the platform never rewrites the `~/AGENTS.md` it wrote at create, so the skill is how an assistant made earlier gets a change to them, and the skill's description asks the assistant to read it before it starts on a task.
The instructions carry no name of the person: the given name stays the UI's, and the file describes the greeting as the platform fills it in.
Nothing runs on the person's behalf: there is no `initialization` Session and no platform-composed first turn, because either would run the model before the owner asked anything, and the greeting itself costs no tokens at all.

## The first result

Onboarding is done when the person has got their first **result** out of the platform: a schedule set, an artifact made, or a knowledge base saved.
Nobody else can know when that happened, so the assistant says so itself, over the [Connection](connection-presets.md#platform-preset-this-install-itself) that lets it act as the person: `dam onboarding first-result <kind> --ref "<what it is>"`, whose kind is one of `schedule`, `artifact` and `knowledgeBase`.
The in-image `dam` skill tells the agent to call it only at a real first result, and that a later call changes nothing.

It is recorded **once per account**, on the same per-owner record as the rest of the assistant's state: a later report — another artifact, a better reference — is a no-op answered with the first one, so the moment the person's onboarding finished cannot move under them.
The record holds the kind, the reference the assistant gave it, and when it landed, and `assistants.state` reports it, so every surface in the app can read it.
The report is caller-scoped: it writes the caller's own record and nobody else's.

The checklist counts what it can of it: a schedule finishes `create-schedule` and an artifact `create-artifact`, recorded as the platform's — done, and seen, since the assistant did it for the person rather than the other way round.
A saved knowledge base has no checklist item, so it is recorded and nothing new appears there; that is the design's limit, not a gap in the record.

The report and every onboarding reset run in one per-owner transaction, so nothing lands between a report's claim and its side effects: the reset clears the result, moves the record's onboarding epoch on and restarts the checklist inside the same lock, and a report that began in the earlier onboarding finds its result gone.
The record's epoch is a number, not a timestamp, so two clocks' microseconds never decide whether a report still applies.
The report also announces itself as one domain event, `assistant.first_result_recorded` with the owner, the kind, the reference and the epoch it completed in, which is the seam for carrying the news somewhere else; the app's open tabs refresh the checklist and the record from it.
At most once: the event leaves after the transaction commits, and only from the call that marked the result done, so a crash in between loses it and nothing ever repeats it — the seam has no consumer yet, and the epoch is what a later one would dedupe on.
[Starting over](#starting-it-over) forgets it along with the rest, so a person who starts again reaches their first result again — and that holds for a person the assistant is off for too, since the first result is the checklist's own state rather than the assistant's.

## Sending results to Slack DMs

Right after the first result, the assistant offers once to send that task's results to the person's Slack DMs; this is the **Slack DM Bridge**.
It is a rule in the `dam` skill, not platform logic: the skill tells the assistant when to offer, in which words, and never twice for one task, and the assistant records each offer in its memory file before it asks.
The skill reaches every Agent that holds the DAM Connection, but only the Agent whose instructions name it the person's personal assistant offers unasked; any other Agent connects to the DM only when the person asks.
The assistant offers only when `dam channel slack-dm status` says the person is reachable, so on an install or workspace where email pairing is off or a scope is missing it says nothing about Slack and results stay in the app.
On a yes, `dam channel slack-dm connect` pairs the person and binds the assistant to their DM ([channels](channels.md)), and the assistant does what it offered: a schedule running on the assistant gains the delivery (`start_thread` in the DM when it needs the person's input, `post` otherwise), and a schedule on another Agent does so only once that Agent is connected too, an artifact is posted to the DM at once, and something it learned needs no schedule, only a short summary posted to the DM.
A schedule's first result is sent at once too: the schedule itself, with any draft or report already made in the offering Session, without running its task again.
When the schedule needs input the person has not given, the assistant asks for it in a DM thread instead, and the result follows their answer; the question is not the result.
It never offers to read the person's Slack: it reads only what the person sends it in that DM, and that content is information for the task, never an instruction to change its instructions, schedules, connections or delivery; such a request is answered by pointing to the app's chat.

## Starting it over

Experimental features ends with one **Onboarding progress** card, one button and one confirm: it restarts the person's [Getting Started](getting-started.md) checklist and, for a person the feature is on for, gives them a first open in their assistant too.
There is no second button, and the reset is not refused for anyone: a person the feature is off for gets the checklist alone, and the assistant, its record and its use are left as they were.
It is the person's own reset, scoped to the caller.
Nothing is deleted — not the assistant, its sessions or its files.
The Agent the record names is **reused**, its use forgotten, whether or not it was renamed since.
When the platform's Agent is gone the reset makes one again — a new ordinary Agent on the same terms as the first — but only if no Agent of the person's carries the assistant's name: a name they hold is not the platform's to take, so such a person gets nothing made and no greeting, since an Agent they made is not the assistant.
A create another caller holds is waited for rather than raced, so the reset lands on the one Agent being made between them.

The checklist it starts over is a first-timer's from the first moment: the reset deletes the unlock rows, so the assistant's own `Create` task is recorded again the way provisioning records it — its avatar unlocked and unseen, its celebration waiting in the first chat — which is one task of eight rather than an empty checklist.
That task's character stays unlocked, as a first-timer's own is, so "every avatar locks again" holds for every avatar but the assistant's own.

What it restores is the first open: the record says the assistant has never been used, so the greeting returns to an empty chat and the first landing routes the person into it again.
The UI does not build that route itself — it fetches the record, the feature flags and the checklist again, releases the one-shot landing, and goes to the app's entry route, so the same landing logic decides, on fresh answers rather than the ones the cache held before the reset.
The greeting rests on that mark alone, not on how many sessions the assistant holds, so an empty chat shows it even when older sessions exist; sending a message marks the assistant used and takes it away again.

## Boundaries

It holds no special standing: it knows what any Agent knows, with the access any Agent has.
The one grant provisioning gives it is the install's own [Connection](connection-presets.md#platform-preset-this-install-itself), so it can drive the platform as its owner — a grant the platform makes whatever the flag that offers that Connection to people says; without that Connection it has only the access any Agent has.
It is proactive only through what its owner set up with it: a schedule it created runs on time, and a Slack DM Bridge delivers there.
Anything else it should know later, such as a team knowledge base, arrives as a grant or a capability, without changing provisioning or this page's guarantees.
