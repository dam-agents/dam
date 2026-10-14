# Agent avatars

Last verified: 2026-10-14

## Overview

Every Agent shows one of eight fixed characters built from the Eye-Bee-M rebus, beside its name wherever the UI shows the Agent, and its chat messages carry its name.
The characters tell a user's Agents apart at a glance and show each one's state without a label.

## Choosing a character

The owner picks the character in the Agent's settings, and the choice is stored on the Agent spec, so renaming keeps it.
A user picks only from the characters they unlocked on the [Getting Started Checklist](getting-started.md); the rest show as eggs.
A create from the UI stores the unlocked character the owner uses least, so new Agents differ by default; the kit modal shows it and lets the owner pick another before applying.
An Agent with no stored choice, or one the platform does not know, shows a character picked by a hash of its name and its owner's identity.
A rename from the settings page stores the character the page shows, so the Agent keeps it; a rename by any other path can change it.

## State

The eyes follow the [lifecycle](agent-lifecycle.md): open while the Agent runs, working or idle, and closed while it sleeps.
A sleeping character keeps its colours and twitches now and then.
Each awake character makes its own small gesture on hover, a sleeping one breathes, and the waking screen of a container Agent loops the gesture while it starts ([lifecycle](agent-lifecycle.md#wake)).
Motion stops when the user's system asks for reduced motion.

## One drawing everywhere

The drawing is shared by the UI and the api-server, so every surface shows the same character.
Slack replies are the one place an avatar leaves the browser: where a workspace grants the persona scope, the api-server renders the character to a PNG and uploads it to a public image host for the message icon ([channels](channels.md#slack-scopes-required-vs-optional)).
