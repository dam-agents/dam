# Getting started

Last verified: 2026-11-14

## Overview

A new user meets the platform's concepts one at a time through the **Getting Started Checklist**: eight tasks, each a feature worth trying, and each one done unlocks one of the eight [avatar characters](agent-avatars.md).
The tasks are: create an Agent, send it a message, create a [connection](connections.md), add a [skill](skills.md), try a [starter kit](starter-kits.md), create a [schedule](schedules.md), create an [artifact](artifact-library.md), and bind an Agent to a Slack [channel](channels.md).
The checklist is per user, not per Agent, so a user with five Agents sees it once.

## Done means it happened

A task is done when the api-server sees the domain event that the feature already emits, not when the user clicks through the UI.
So a task counts the same whether the user did it in the browser, with the CLI, through a starter kit, or by asking an Agent to do it with its own tools.
The api-server records each unlock in Postgres and keeps it after the thing that earned it is deleted, so an avatar never locks again unless the user resets their onboarding progress.
Each replica remembers the tasks it already recorded, so the message sent on every prompt costs nothing after the first.

The character a task unlocks is random among the ones still locked, with one exception: the first Agent unlocks the character it was created with while that character is still locked, so the avatar the user sees on it is the one they just unlocked.
When another task already unlocked that character, the first Agent unlocks a random locked one, and the UI does not claim it is on the Agent.
A user with nothing unlocked yet gets a first Agent with the character its name gives it, which the create stores on the Agent.
The [assistant](assistant.md) is an Agent like any other here: provisioning enrols a person first, so the assistant counts as their first Agent and finishes `Create`.
Because nobody made that Agent by hand, its unlock is recorded unseen and the first chat plays it — the same celebration, in the place the person first meets the Agent, and marking it seen from there is what finishes `Create`.
An owner whose avatars are all seen has none left to unlock, so nothing celebrates for them.
The assistant can also report the tasks it did for the person — the schedule or the artifact that was their [first result](assistant.md#the-first-result) — recorded the same way, done and seen: a saved knowledge base finishes no task here, since the checklist has no item for one.
That is the same record a reset makes, so a person who has reset their onboarding meets a first-timer's checklist: one task of eight, its celebration waiting in their first chat.
Concurrent unlocks for one user are serialized in the database, so two tasks never unlock the same character.

## Who sees the checklist

The api-server decides once, the first time it meets a user here, whether the checklist applies.
A user who already owns an Agent at that moment used the product before the checklist existed: they get every character at once, already seen, and no checklist.
The Agent whose create is that first meeting does not count.

The checklist has one reset door left: the assistant's onboarding reset ([assistant](assistant.md#starting-it-over)), which clears the checklist and the assistant's first result in one locked transaction.
There is no checklist-only reset procedure: a second door that cleared the checklist without the first result was a way around the protocol.

## In the browser

The UI shows the checklist as the **Get started** item in the sidebar footer, above Documentation and Settings: a progress ring, its label, and a count of the unlocks the user has not seen.
A collapsed sidebar shows the ring alone, and names the progress for a screen reader.
A click on the item opens the checklist in a popover beside it: the same ring, the done count, a strip of the eight characters with an egg for each one still locked, and the eight tasks, each with an info mark that gives a one-line reason for it.
A click elsewhere on the page, Escape, the popover's close button or its Dismiss closes it back to the item, so a user cannot be left with it over a button they want.
Nothing opens it but that click: an unlock the user has not seen puts a count on the item instead.
Each row opens the place where the task is done; tasks on an Agent open the newest one, and the chat tasks leave a starting line in its composer, including the artifact task, which asks for a one-page artifact because an artifact is something an Agent makes; in an Agent's chat the artifact task opens the Artifacts section beside the conversation instead.
A click on a row closes the checklist before it takes the user there.
Every unlock is pushed to the owner's open tabs as a [live hint](platform-topology.md); while the popover is open it plays a short celebration beside the item for each unlock the user has not seen, one at a time, in place of the task list, then records it as seen.

The item stays in the footer until the checklist is done; closing the popover only closes it.
A checklist dismissed through the API stays hidden until the next unlock, which brings the item back, or until the user asks for the checklist from the avatar picker, which opens the popover.
Once every character is unlocked and seen, the item is gone until the user resets their onboarding progress from the Experimental features tab.
That reset deletes every unlock and reopens the checklist; characters already on Agents stay on them, and the one the [assistant](assistant.md#starting-it-over) carries is unlocked unseen, so its celebration plays again in the first chat and the reset finishes `Create` only once that is seen.
For a person the assistant is on for, the same reset also gives them a first open in it — its use forgotten, and one they deleted made again — and takes them to the entry route as a first-timer; a person it is off for keeps the checklist alone.
The replica that serves the reset forgets the tasks it recorded for that user, so redoing one unlocks again; another replica skips a task it already recorded until it restarts.
The avatar picker offers only unlocked characters, plus the one the Agent already shows; the rest appear as eggs.
A newly unlocked character carries a dot in the picker, and on the picker's button, until the user first opens the picker; the dots stay while that picker is open, so the user sees which characters are new.
The first Agent's own character, already in use, never carries one.
The lock is a UI affordance: the api-server accepts any character on an Agent.
