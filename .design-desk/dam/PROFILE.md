# DAM — what a designer should know

This is the design profile of DAM for the Design Desk agent.
The agent reads it from the default branch to explain shipped changes to designers, to triage design requests, and to build live prototypes.
A change to a UI flow, a screen's place in the app, or the paths below updates this profile in the same pull request.

## The product in two paragraphs

DAM runs AI agents for people.
Each agent has its own workspace, its own credentials and its own schedule, and works on its own after the person closes their laptop.
A person creates an agent, often from a starter kit, talks to it in its chat, and finds its work products in Artifacts.

The people who use DAM are developers and their teams.
Most screens serve one owner and their own agents: there are no teams or workspaces, and someone else's work is seen only when it is shared (an artifact link, a public agent, a shared connection).

## Words

Use the words in [`docs/ubiquitous-language.md`](../../docs/ubiquitous-language.md), the section "Words users read" first, and never a word from "Retired words".
The thing a user owns is an **agent**.
Folder names in the code are internal: `sandboxes` is an agent's configuration page, `sessions` is the chat, `platform` is the app shell.

## Main screens

- **Home** — what changed since the user last looked: agents, usage, spend.
- **An agent's chat** — the conversation, with the files and artifacts panel beside it.
- **An agent's configuration** — its harness, model, connections, schedules, skills, login items and environments.
- **Artifacts** — the library of published work, with sharing.
- **Starter kits** — ready setups an agent is created from.
- **Settings** — providers, connections, API keys, usage, appearance.

## Design rules the code does not state

- Simple and quiet: the smallest clean change; reuse an existing row, badge, section or dialog before inventing a device.
- Buttons are black (`bg-primary`); blue is only for links and accents.
- Destructive means red and a confirmation dialog; a warning is an amber icon with a black button.
- Empty states say what will be here and the one action that fills it.
- Light and dark themes both ship; every change works in both.
- Feature flags: build what users see by default (flags off) unless a request is about a flagged experiment.

## Where the "why" lives

- The pull request: its description, its Web UI proof screenshots, and the hidden `author-decisions` block at its end.
- The issue it closes, with its comments.
- The architecture pages under [`docs/architecture/`](../../docs/architecture/), the source of truth for behaviour.

## What a live prototype can and cannot show

A live prototype is a full install of the branch in an Environment, signed in with a demo account the agent shows on the Desk.
It starts empty, like a new user's DAM: no agents, no artifacts, no providers.
It has no model provider, no Slack and no GitHub, so an agent cannot run a turn; screens, navigation, dialogs, forms and empty states can all be tried.
The install takes many minutes the first time; a later design change rebuilds only the UI.

## The design-only boundary here

A design change may touch the components and views of `packages/ui/src`, its shared components, its styles and its public assets.
It may not touch `api/`, `hooks/`, `store/`, `lib/`, `utils/` or `forms/` folders, the files at the root of `packages/ui/src`, the tests, or anything outside `packages/ui`.
The full lists are in `profile.json` → `boundary`.
