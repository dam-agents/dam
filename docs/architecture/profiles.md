# Profiles

Last verified: 2026-11-05

## Overview

A **profile** is one owner's named harness, provider template, model, platform sub-agent and settings, usable on all their agents.
It names the kind of provider, not one Connection, so it runs on whatever Connection of that template the agent holds; a rival Connection of the same alias never stands in for it.
Profiles are saved from a chat's model picker (Save as a profile, or on a pick that came from or matches one Update beside Save as a new profile) or made with New profile in Settings › Providers › Profiles, and edited in a chat or in that list, whose rows open the same picker on its Custom selection, listing models from the [owner catalog](owner-model-catalog.md).
Every list of profiles, in Settings and in each picker, shows the default for new agents first, then the most used (the agents, channels and schedules that name one), then by name.
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
A subagent slot that holds a profile which can no longer run leaves the subagent to the agent, and a sub-agent the profile lends that cannot run refuses the run rather than running on another; an edit that breaks it is put back like any other no agent can run.
A profile in use cannot be deleted, and the refusal names what uses it.

## The default for new agents

Each owner has exactly one **default for new agents**, which cannot be deleted while it is; another profile is made the default first, from its row in Settings.
An owner with no profile is given "Default" on the deployment's shared CurveBender, with the harness and model the install sets under `apiServer.defaultProfile`.
A new agent whose default names the shared CurveBender, for an owner who holds none of it yet, reconciles the deployment-owned Connections before it starts, so the first create on an account that never listed Connections still starts on it.
An install without the shared CurveBender, or with either value empty, gives "Default" from the owner's first provider once it has listed its models: the install's default harness where that provider runs it, else the first harness it runs, and the model the platform prefers for work on that harness, else the first it lists.
An owner who already has profiles gets no "Default"; their oldest becomes the default.
A new agent on the default template takes the default's harness unless its create names one, and then, on that harness, is granted the default's provider alone in place of the harness's provider order, and its chat default is the profile.
The default exists before the agent's first `hello`, so a starter kit's onboarding turn has a model to run on; a kit that names its own model, an Environment and an agent on another harness keep the provider order and the first-hello conversion, and a kit that lists its providers takes the first of them the owner holds, else the provider order.
A create that cannot start the agent on the default logs why, and the agent falls back to that conversion.
A create that names no provider answers which one it granted and what chose it — the default (with its name, model and harness), the starter kit's providers list, the Template's providers list, or the harness's provider order; the CLI prints it, so a caller sees a provider it did not expect.
