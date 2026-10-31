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

This is taste, not a spec: read the real components for shapes and values.

- Simple and quiet: the smallest clean change; reuse an existing row, badge, section or dialog before inventing a device.
- Avoid meters, trays, steppers and side panels; if a control needs a legend, it is too complex.
- Buttons are black (`bg-primary`).
- Blue (`accent`) is only for links, the active navigation item, focus and the unread dot.
- Colors have fixed meanings: green is success and running; amber is a warning and the dot on a session waiting for approval; red is an error or a destructive action; purple is starter kits and templates.
- Destructive means red and a confirmation dialog whose verb repeats the action ("Remove", "Delete"); a warning (for example switching a running agent's provider) is an amber icon with a black button, never red.
  In code this is `confirm-dialog.tsx` with `destructive` or `default`.
- Mono type (IBM Plex Mono, tabular figures) for repository names, URLs, ids and numbers.
- Menus overlay the page and never push it down; helper text sits below its control.
- A single-select list shows connected or active items first, then the rest alphabetically, with no divider.
- Empty states say what will be here and the one action that fills it.
- Light and dark themes both ship; every change works in both.
- Show the agent doing the work (starting, working, reporting) rather than describing it; prefer setup guided in the chat over long forms.

## Words, beyond the glossary

- "Sandbox" only for the machine; the thing a person owns is an agent.
- "Share" and "who can access", never "MCP server", in anything a person reads.

## Reading the shell

Build every screen inside the app's real frame.
The imports from `packages/ui/src/app.tsx` are the map; these paths are hints that may move.

- The sidebar: its width when expanded is `SIDEBAR_DEFAULT_W` in `modules/platform/lib/sidebar-layout.ts`; its destinations, in order, come from `modules/platform/hooks/use-sidebar-destinations.ts`, with the agents and activity under them.
- The page column: its padding and the maximum width of the view you change.
- The right side: `modules/sessions/components/side-panel-bar.tsx`, and which tabs a view hides (`hiddenSidePanelTabs()` in `modules/sessions/lib/side-panel.ts`).
- An agent's configuration page: `modules/sandboxes/views/sandbox-home-view.tsx`, its sections in `components/sandbox-section-nav.tsx`, and their derived counts in `hooks/use-section-summaries.ts`.
  Read the function behind a count ("4 enabled") and make sample data agree with it.
- The chat: `modules/sessions/views/chat-view.tsx`, whose only layout is `modules/sessions/components/classic-chat-layout.tsx`.

## Feature flags

Flags are read with `useFeatures()` from `modules/features/api/queries.ts` (and `lib/visible-features.ts`).
Build what users see by default (flags off) unless a request is about a flagged experiment, and say which.
A flag can change more than layout: even an icon (the Artifacts destination's) changes with one.

## Drawing DAM's own parts

Never draw an icon by hand or use a letter tile for an agent.
Render these with `<ui-component>`:

| Part                       | File (under `packages/ui/src/`)                     | Export, props                                                                                                                                |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| An agent's avatar          | `modules/agents/components/avatar/agent-avatar.tsx` | `AgentAvatar`, `{name, size, mood}`: `awake`; `asleep` when hibernated or a stop is requested; `disabled` when disabled (see `avatarMood()`) |
| The brand mark             | `components/brand-logo.tsx`                         | `BrandLogo`                                                                                                                                  |
| Harness and provider marks | `components/brand-icons.tsx`                        | `ClaudeIcon`, `CodexIcon`, `PiIcon`, `BobFilledIcon`, … (tile colors in `components/harness-icons.tsx`)                                      |
| Icons                      | `@carbon/icons-react`                               | `<ui-icon name="…">` with the name the code imports                                                                                          |
| Pictograms                 | `@carbon/pictograms-react`                          | `<ui-pictogram>` for page headers and empty states                                                                                           |

For a new action with no icon yet, use the icon the app already uses for the closest action, and say so.
Menus are portalled to the page body by the review bar; dialogs reuse `confirm-dialog.tsx`'s markup.

## Where the real thing lives

| What                                         | Where (under `packages/ui/src/`)                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Buttons, badges, cards, menus, dialogs, tabs | `components/ui/`                                                                         |
| Page headers, list sections, empty states    | `components/ui/page-header.tsx`, `list-section.tsx`, `empty-state.tsx`, `empty-hero.tsx` |
| The app shell and sidebar                    | `modules/platform/`                                                                      |
| An agent's chat                              | `modules/sessions/`                                                                      |
| An agent's configuration                     | `modules/sandboxes/`                                                                     |
| Theme tokens                                 | `App.css`                                                                                |

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
