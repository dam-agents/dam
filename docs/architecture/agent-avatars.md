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

## Custom avatars

Behind the `custom-avatars` [experimental feature](features.md), the picker also takes one emoji, or an uploaded JPG or PNG.
The spec then stores `emoji:<emoji>` or `image:<id>`; anything else that is not a known character falls back to the hashed character.
An emoji is accepted only as a single RGI emoji, and is drawn as SVG text, so it looks like the viewer's system emoji.
An upload is at most 2 MB; the api-server crops it to a 512 px square PNG and stores it in Postgres under the SHA-256 of that PNG.
It is served without sign-in, because an `<img>` sends no token; the id is a hash, so it cannot be guessed, and the image never changes.
A custom avatar has no eyes, so it shows no mood: it only greys out while the Agent sleeps.

## State

The eyes follow the [lifecycle](agent-lifecycle.md): open while the Agent works on a prompt, closed between prompts, and closed and greyed while it hibernates or is stopped.
Each character makes its own small gesture on hover, a hibernating one breathes, and the waking screen of a container Agent loops the gesture while it starts ([lifecycle](agent-lifecycle.md#wake)).
Motion stops when the user's system asks for reduced motion.

## One drawing everywhere

The drawing is shared by the UI and the api-server, so every surface shows the same character.
Slack replies are the one place an avatar leaves the browser: where a workspace grants the persona scope, the api-server renders the character to a PNG, or reads the uploaded one, and uploads it to a public image host for the message icon ([channels](channels.md#slack-scopes-required-vs-optional)).
An emoji avatar is never uploaded: Slack gets the public Twemoji PNG for it, so it looks different from the UI's system emoji.
