# Profiles

Last verified: 2026-11-13

## Overview

A **profile** is one owner's named harness, provider template, model, platform sub-agent and settings, usable on all their agents.
It names the kind of provider, not one Connection, so it runs on whatever Connection of that template the agent holds; a rival Connection of the same alias never stands in for it.
Profiles are saved from a chat's model picker (Save as a profile, or on a pick that came from or matches one Update beside Save as a new profile) or made with New profile in Settings › Providers › Profiles, and edited in a chat or in that list, whose rows open the same picker on its Custom selection, listing models from the [owner catalog](owner-model-catalog.md).
Every list of profiles, in Settings and in each picker, shows the most used first (the agents, channels, schedules and interactive pages that name one), then by name.
Custom selection is one screen wherever a pick is made: a new or running chat's primary model, a channel's and a schedule's, and a profile in Settings; none of them holds tool approval.
A channel and a schedule pick in the chat's own picker, both slots in it.
A subagent is a model and the provider it runs on, under **More options**, or **Same as agent**, which lets the harness pick; a profile carries a subagent the same way, and its picker offers it beside the model.
A running chat's primary offers only the profiles on the session's harness, which it keeps.

## What follows a profile

The chat default, each Slack and Telegram channel, and each schedule hold the same two slots, a primary model and a subagent, each either a profile reference or values of their own, never both; an empty subagent slot follows the primary's profile, which names one too, and with no profile behind it lets the agent pick.
The api-server resolves a reference into the pair the runtime is sent, so an edit reaches every later run that follows it, while a session that picked keeps its own ([harness configuration](harness-config.md#session-settings)).
The agent's Providers, Channels and Schedules pages pick the three with the same picker, which a page shows as a row: its chat default, its channel pair and its scheduled pair.
Only the chat default keeps a profile reference; a profile picked on the Channels or Schedules page is stored as its values, so a later edit of that profile does not reach it.
The channel and scheduled pickers lead with **Use agent default**, which reads the chat default; picking it clears their own pair, so they follow that default and every later change of it.
A channel or schedule naming none follows its kind's pair, which is the chat default until the agent's page sets one; picking a profile grants its provider on the agent.
An edit that no agent using the profile can run is put back, and that revert never undoes a newer edit made meanwhile.
A profile's platform sub-agent runs on the profile's harness and the agent's Connection of its own provider template, and its model is a model of that template; a slot with a subagent pick of its own never runs it, whole, and a null or absent sub-agent is **Same as agent**, which lets the harness pick.
A subagent slot that holds a profile which can no longer run leaves the subagent to the agent, and a run whose profile lends a sub-agent that cannot run goes on, on the profile's primary model without it; an edit that breaks it is put back like any other no agent can run.
An interactive page keeps the same two slots for the Sessions its prompts open ([a page's model](artifact-library.md#a-pages-model)).
A profile in use cannot be deleted, and the refusal names what uses it.

## The default for new agents

Each owner has one **default for new agents**, picked in Settings › Providers with the same picker an agent's Providers page shows: a profile, or values of their own (harness, one of their provider Connections and a model), the way a Custom pick saves them.
It is the top layer: a new agent's chat default is initialised from it, and from then on the agent's own chat default decides what its new chats run on; nothing reads the owner's default at run time.
New profile opens on it, and a harness or provider picked there starts on its model where that harness and provider offer one, so a profile made without a reason of its own runs what a new agent runs.
No profile is a default and none is made for an owner, so every profile not in use can be deleted.
While the owner picked nothing, the **base default** applies: Pi on the owner's shared CurveBender Connection, with the CurveBender work model (DeepSeek), as values.
A picked profile that is deleted takes the pick with it, and values whose Connection the owner no longer holds give way to the base default at the next create.
The base default exists only where the install serves the shared CurveBender and its catalog has Pi; elsewhere a new agent of an owner who picked nothing boots the install's default harness on the first provider in its order, and its first `hello` converts its default ([harness configuration](harness-config.md#session-settings)).
A new agent on the default template takes the default's harness unless its create names one or names a provider that does not run it, and then, on that harness, is granted the default's provider alone in place of the harness's provider order; its chat default is the profile, or the values; a create that names another provider, or its own model, is left out of the default ([agent-lifecycle](agent-lifecycle.md#create)).
A default naming the shared CurveBender, for an owner who holds none of it yet, reconciles the deployment-owned Connections before the agent starts, so the first create on an account that never listed Connections still starts on it.
The chat default exists before the agent's first `hello`, so a starter kit's onboarding turn has a model to run on; a kit that names its own model, an Environment and an agent on another harness keep the provider order and the first-hello conversion, and a kit that lists its providers takes the first of them the owner holds, else the provider order.
A create that cannot start the agent on the default logs why, and the agent falls back to that conversion.
A create that names no provider answers which one it granted and what chose it — the default (a profile with its name, or values, with the model and harness), the starter kit's providers list, the Template's providers list, or the harness's provider order; the CLI prints it, so a caller sees a provider it did not expect.
