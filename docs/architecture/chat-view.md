# Chat view

Last verified: 2026-11-11

## Overview

The **chat view** is where a person works with an Agent: the conversation, the composer under it, and a top bar with the Agent's name and its buttons.
The transcript, its Sessions and how a reply streams in are on [sessions](sessions.md) and [platform-topology](platform-topology.md); this page covers what the view itself offers around the conversation: the sections beside it, the composer's example and + menu, and the Agent's settings modal.
None of it adds a rule of its own: every switch it shows is the call the Agent's settings make, under the same permissions.

## Room for the conversation

An Agent's chat gives the conversation the room by default.
Its Files and Artifacts sections start closed; their icons in the chat's top bar open them in a column beside the conversation, stacked when several are open, and the browser keeps each choice as a preference of the person, not of the Agent.
The top bar has, right after the Agent's name, a toggle for Files and one for Artifacts, so a section closed with its X always opens again; an open one is the design's neutral square, and the browser, changes and settings buttons follow, where they were before.
Processes stays in the column as before, folding from its header.
A new chat's empty composer has focus and shows example prompts in place of its placeholder, one at a time, to show what an Agent can be asked; Tab puts the one showing in.
The examples are the design's list, the same for every Agent.
A chat with a conversation, or an assistant's greeting with a first task of its own, keeps the ordinary placeholder.

## The Agent's settings modal

The Agent's settings are a modal, and only a modal: there is no settings page beside it.
The modal is the app's own, mounted beside its other overlays, so every wrench, *Agent settings*, opens it wherever the person is: a sidebar row's, a Home agent card's, and the chat's; so do every prompt and notice that sends a person to a setting — a provider to connect, a spend limit, a disabled Agent's *Enable* — each on its own section.
Every way into the Agent's settings from its chat — its avatar and name and the wrench in the top bar, a reply's agent name, the empty chat's avatar, the assistant greeting's link, and the model pickers' *Manage providers* and *Configure defaults*, at the Providers section — opens the same modal over the chat: all of the Agent's sections and its restart bar, with the open section kept in the modal rather than in the address, so the conversation stays where it was.
The modal's banner shows the Agent's avatar and name, read-only; its editable name and avatar head the General section.
The modal keeps every section, Browser too for an Agent with a browser; the section list, two lines a row, scrolls up and down on its own when it does not fit and never sideways, and the open section scrolls beside it, its bar clear of the content.
The old agent page's address, `/sandboxes/<id>/<section>`, which the server still writes into Slack and Telegram messages and spend alerts, opens the Agent's chat with the modal on that section, never Not found; the address becomes the chat's and keeps an `#anchor` the modal scrolls to, and a sign-in started in the modal returns to it the same way, on Connections.

## The composer's + menu

The composer's + menu is the other way to change an Agent from its chat: next to attaching a file, it lists the Agent's skills, schedules and Connections as the design draws them — the Agent's skills surface in a compact form, each schedule as a card with its switch and the Schedules section's ⋮ menu, the Connections the Agent holds in one card per service with each row's menu — and opens each one's usual create dialog.
For skills and schedules it also offers to describe one, which leaves a starting prompt in the composer, in place of any draft, and sends nothing, so a person learns that the Agent can set these up itself.
Every switch is the same call the Agent's settings make, under the same permissions, so the menu adds no rule of its own.
