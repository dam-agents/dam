# Getting started

Last verified: 2026-10-16

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
Concurrent unlocks for one user are serialized in the database, so two tasks never unlock the same character.

## Who sees the checklist

The api-server decides once, the first time it meets a user here, whether the checklist applies.
A user who already owns an Agent at that moment used the product before the checklist existed: they get every character at once, already seen, and no checklist.
The Agent whose create is that first meeting does not count.

## In the browser

The UI reads the user's progress and renders it as a progress ring beside the approvals bell; it starts collapsed and opens once the first Agent's task is done.
On a wide screen the ring sits in the icon bar along the right edge, above the bell, on every page and in an Agent's chat, and the checklist opens to its left; on a phone it sits in the top bar and the checklist opens below it.
On a wide screen the checklist and the unlock celebration take room beside the bar and narrow the page, so they never cover its buttons; on a phone they float over the page.
Collapsed, it takes no room from the page, so it never covers a chat, its composer or the bell.
Each row opens the place where the task is done; tasks on an Agent open the newest one, and the chat tasks leave a starting line in its composer.
Every unlock is pushed to the owner's open tabs as a [live hint](platform-topology.md), and the dock plays a short celebration for each unlock the user has not seen, one at a time, then records it as seen.

Dismissing the checklist hides it until the next unlock, which opens it again, or until the user asks for it from the avatar picker.
Once every character is unlocked and seen, the checklist is gone until the user resets their onboarding progress from the Experimental features tab.
That reset deletes every unlock and reopens the checklist; characters already on Agents stay on them.
The replica that serves the reset forgets the tasks it recorded for that user, so redoing one unlocks again; another replica skips a task it already recorded until it restarts.
The avatar picker offers only unlocked characters, plus the one the Agent already shows; the rest appear as eggs.
A newly unlocked character carries a dot in the picker, and on the picker's button, until the user first opens the picker; the dots stay while that picker is open, so the user sees which characters are new.
The first Agent's own character, already in use, never carries one.
The lock is a UI affordance: the api-server accepts any character on an Agent.
