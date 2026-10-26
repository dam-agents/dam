# Profiles

Last verified: 2026-10-26

## Overview

A **profile** is one owner's named harness, provider template, model and settings, usable on all their agents.
It names the kind of provider, not one Connection, so it runs on whatever Connection of that template the agent holds; a rival Connection of the same alias never stands in for it.
Profiles are saved from a chat's model picker (Save as a profile, or on a pick that came from one Update beside Save as a new profile) or made with New profile in Settings › Providers › Profiles, and edited in a chat or in that list, whose rows open the same picker on its Custom selection, listing models from the [owner catalog](owner-model-catalog.md).
Custom selection is one screen wherever a pick is made: a new or running chat's primary model and subagent slot, a profile in Settings and a schedule's own values; none of them holds tool approval.

## What follows a profile

The chat default's primary model and its subagent slot, each Slack and Telegram channel, and each schedule hold either a profile reference or values of their own, never both.
The api-server resolves a reference into the pair the runtime is sent, so an edit reaches every later run that follows it, while a session that picked keeps its own ([harness configuration](harness-config.md#session-settings)).
A channel or schedule naming none follows its kind's legacy pair; picking a profile grants its provider on the agent.
An edit that no agent using the profile can run is put back, and that revert never undoes a newer edit made meanwhile.
A profile in use cannot be deleted, and the refusal names what uses it.

## The default for new agents

Each owner has exactly one **default for new agents**, which cannot be deleted while it is; another profile is made the default first, from its row in Settings.
An owner with no profile is given "Default" on the deployment's shared CurveBender, with the harness and model the install sets under `apiServer.defaultProfile`.
An install without the shared CurveBender, or with either value empty, gives "Default" from the owner's first provider once it has listed its models: the install's default harness where that provider runs it, else the first harness it runs, and the model the platform prefers for work, else the first it lists.
An owner who already has profiles gets no "Default"; their oldest becomes the default.
A new agent on the default template takes the default's harness unless its create names one, and then, on that harness, is granted the default's provider alone in place of the harness's provider order, and its chat default is the profile.
The default exists before the agent's first `hello`, so a starter kit's onboarding turn has a model to run on; a kit that names its own model, an Environment and an agent on another harness keep the provider order and the first-hello conversion.
A create that cannot start the agent on the default logs why, and the agent falls back to that conversion.
