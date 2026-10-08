# Agent avatars

Last verified: 2026-10-08

## Overview

Every Agent shows one of eight fixed characters built from the Eye-Bee-M rebus, beside its name wherever the UI shows the Agent, and its chat messages carry its name. The characters tell a user's Agents apart at a glance and show each one's state without a label.

## Choosing a character

The owner picks the character on the create page or in the Agent's settings, and the choice is stored on the Agent spec, so renaming keeps it. The create page offers the character the owner uses least, so new Agents differ by default. An Agent with no stored choice, or one the platform does not know, shows a character picked by a hash of its name and its owner's identity; renaming such an Agent can change it.

## State

The eyes follow the [lifecycle](agent-lifecycle.md): open while the Agent works on a prompt, closed between prompts, and closed and greyed while it hibernates or is stopped. Each character makes its own small gesture on hover, a hibernating one breathes, and the waking screen loops the gesture while the Agent starts. Motion stops when the user's system asks for reduced motion.

## One drawing everywhere

The drawing is shared by the UI and the api-server, so every surface shows the same character. Slack replies are the one place an avatar leaves the browser: where a workspace grants the persona scope, the api-server renders the character to a PNG and uploads it to a public image host for the message icon ([channels](channels.md#slack-scopes-required-vs-optional)).
