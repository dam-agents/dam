# Getting started

Last verified: 2026-10-19

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

The UI shows the checklist as the **Get started** side panel, a panel like any other on the right edge: its icon, a progress ring, sits in the icon bar above the approvals bell on every page and in an Agent's chat, and opens and closes the panel the way the other icons open theirs.
The panel takes its room from the page, as every side panel does, so it never covers the page's buttons, and it shares their width, resize handle, close X and phone behavior.
Every side panel's top bar ends with that X, behind a vertical border; it closes the panel.
On a phone the X is hidden, the ring sits in the top bar and the panel fills the screen under a back button.
The panel opens only when the user asks for it.
An unlock the user has not seen puts a count on the ring instead of opening the panel.
Each row opens the place where the task is done; tasks on an Agent open the newest one, the chat tasks leave a starting line in its composer, and the artifact task opens the side panel's Artifacts tab.
Every unlock is pushed to the owner's open tabs as a [live hint](platform-topology.md); the panel plays a short celebration at its top for each unlock the user has not seen, one at a time, while it is open, then records it as seen.

In an Agent's chat with the [new layout](home-feed.md#the-new-layout) off, the chat has no icon bar: the ring sits in the chat's top bar beside the bell and opens the panel in the slot beside the conversation.
The ring stays in the icon bar until the checklist is done; closing the panel only closes it.
A checklist dismissed through the API stays hidden until the next unlock, which brings the ring back, or until the user asks for the checklist from the avatar picker, which opens the panel.
Once every character is unlocked and seen, the checklist is gone until the user resets their onboarding progress from the Experimental features tab.
That reset deletes every unlock and reopens the checklist; characters already on Agents stay on them.
The replica that serves the reset forgets the tasks it recorded for that user, so redoing one unlocks again; another replica skips a task it already recorded until it restarts.
The avatar picker offers only unlocked characters, plus the one the Agent already shows; the rest appear as eggs.
A newly unlocked character carries a dot in the picker, and on the picker's button, until the user first opens the picker; the dots stay while that picker is open, so the user sees which characters are new.
The first Agent's own character, already in use, never carries one.
The lock is a UI affordance: the api-server accepts any character on an Agent.
