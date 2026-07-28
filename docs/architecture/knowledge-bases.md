# Knowledge Bases

Last verified: 2026-07-28

## Overview

A **Knowledge Base** is an Agent that builds and maintains a body of knowledge the user works with through chat. The platform deliberately owns almost none of it: no ingestion pipeline, no query API, no knowledge schema. Following the Experiments bet, the behavior lives in the agent, and the platform provides only the structural shell — a way to create the pairing and a surface to list it.

Two pieces make an Agent a Knowledge Base:

- **The Agent Kind marker.** A create-time annotation on the Agent (`knowledge-base`), immutable afterwards, surfaced on the Agent view. The Sandboxes list shows every agent badged with its Kind; the Knowledge Bases destination is a filtered view onto the same agents, not an exclusive home — a knowledge base *is* a sandbox, and hiding it would remove it from the owner's inventory of what they are paying to run. Everything else about the agent — lifecycle, sessions, connections, schedules, budgets — is a plain Agent. The marker is shared machinery: [experiments](experiments.md) uses the same one, and both ride a shared kinded-create rail owned by the agents module.
- **The Install Command.** A one-shot shell command run in the Agent's workspace at create, which bootstraps the agent's knowledge tooling from an external installer. No agent turn is involved — it is a workspace mutation, not a conversation. The command is chosen by the **KB template** the user picks at create (the researcher-facing "Template" — the installation procedure, distinct from the pinned harness image). Two exist today — LLM Wiki (a toolkit) and Plain Wiki (markdown-only, offline); the server maps the template id to its command, and a new procedure is a new id plus a new mapping. Each template's bootstrap installs a `/wiki-onboard` command, so the greeting (below) stays template-agnostic. The platform ships the pointer, never the tooling. The picked template id rides the same create-time annotation stamp as the Kind marker and is surfaced on the Agent view (opaque to the agents module — the knowledge-bases surface owns the id set), so the KB list can display which procedure a knowledge base came from; it is absent on knowledge bases created before it was recorded.

## Create flow

The owner-scoped knowledge-bases module owns creation and nothing else — reads ride the agents surface. Create is a composition of existing rails:

1. **Agent create** with the Kind marker, passing the standard create choices through (provider and catalog connections, size, egress preset) plus the picked KB template. The UI pins the Claude Code harness image and hides it (one image, not a user choice); the server still accepts any image, so that choice can fold into the KB template later.
2. **Install Command delivery** over the `workspace-command` rail — a one-shot runtime-channel event alongside `workspace-seed`, on the same durable outbox schedules and Experiments use ([connections](connections.md#event-lifecycle), [agent-lifecycle](agent-lifecycle.md#trigger-fire)). The event survives the pod not being up yet — including an agent parked over budget — and is delivered once the agent is Ready. agent-runtime runs the command in the workspace, in the pod's environment, so egress rides the paired gateway exactly as a harness process would. It runs once: the plugin writes a sentinel on success, so a redelivery (or a pod killed mid-run before the outbox settled) never double-runs a completed install. A failed run stays pending and retries on the next wake until it succeeds or the event's TTL lapses.
3. **Wake**, so the freshly created agent comes up and runs the bootstrap before the user does anything. No session is opened and no turn runs — the command mutates the workspace, then the user chats with the ready-made knowledge base.

The module has no persistence of its own: a Knowledge Base is exactly the owner's Agent plus the marker, and deleting the agent deletes the Knowledge Base.

## UI

Knowledge Bases is a feature-gated destination ([features](features.md)) with a list and a **standalone per-KB page** — the chat surface under the knowledge base's own route, so the rail keeps the Knowledge Bases context and leaving returns to the KB list, never to Sandboxes. Creation is **not** its own form: it is the `knowledge-base` starting point on the shared [sandbox wizard](agent-lifecycle.md)'s first step, which pins the Claude Code harness, hides it, and reveals the KB Template picker; the wizard's finish dispatches to this module's create. The KB list's own "New knowledge base" button enters that wizard with the starting point pre-picked.

Opening a KB that has no sessions yet **greets the user**: the UI runs `/wiki-onboard` as a hidden first turn (reaches the agent, renders no user bubble, fails silently), so a fresh KB opens with the agent introducing itself rather than an empty chat. This is why every template's bootstrap installs that command. The greeting mechanism is shared with experiments.

One known gap: the greeting races the bootstrap. It fires once the agent is running, but the Install Command lands after Ready, so a very fast open can run `/wiki-onboard` before it exists. Experiments close this by waiting for their authoring skill to be reported present; a KB has nothing equivalent to probe, because its onboarding artifact is a *command* and that read covers only skills.

The create itself is compensated rather than transactional: the marker is stamped by the agent create while the install event is enqueued after it, and a failed enqueue deletes the fresh agent and surfaces the failure — so a marked agent whose setup never ran can only arise if that compensating delete itself fails.

Lifecycle actions (wake, restart, pause, stop, delete) are the standard agent actions.

## Where the code lives

- Contract: [`packages/api-server-api/src/modules/knowledge-bases/`](../../packages/api-server-api/src/modules/knowledge-bases/)
- Implementation: [`packages/api-server/src/modules/knowledge-bases/`](../../packages/api-server/src/modules/knowledge-bases/)
- Kind marker plumbing: [`packages/api-server/src/modules/agents/`](../../packages/api-server/src/modules/agents/)
- UI destination: [`packages/ui/src/modules/knowledge-bases/`](../../packages/ui/src/modules/knowledge-bases/)
