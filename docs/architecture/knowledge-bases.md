# Knowledge Bases

Last verified: 2026-07-24

## Overview

A **Knowledge Base** is an Agent that builds and maintains a body of knowledge the user works with through chat. The platform deliberately owns almost none of it: no ingestion pipeline, no query API, no knowledge schema. Following the Experiments bet, the behavior lives in the agent, and the platform provides only the structural shell — a way to create the pairing and a surface to list it.

Two pieces make an Agent a Knowledge Base:

- **The Agent Kind marker.** A create-time annotation on the Agent (`knowledge-base`), immutable afterwards, surfaced on the Agent view. Each list surface filters on it, so an agent appears on exactly one surface: the Sandboxes list shows unmarked agents, the Knowledge Bases list shows marked ones. Everything else about the agent — lifecycle, sessions, connections, schedules, budgets — is a plain Agent.
- **The Install Command.** A one-shot shell command run in the Agent's workspace at create, which bootstraps the agent's knowledge tooling from an external installer. No agent turn is involved — it is a workspace mutation, not a conversation. v1 pins one command (the LLM Wiki bootstrap) for every Knowledge Base; it is meant to become a Template concern once KB templates exist. The platform ships the pointer, never the tooling.

## Create flow

The owner-scoped knowledge-bases module owns creation and nothing else — reads ride the agents surface. Create is a composition of existing rails:

1. **Agent create** with the Kind marker, passing the standard create choices through (image/template, provider and catalog connections, size, egress preset). The UI pins the Claude Code template and hides other harnesses; the server accepts any image, so that choice can move into templates later.
2. **Install Command delivery** over the `workspace-command` rail — a one-shot runtime-channel event alongside `workspace-seed`, on the same durable outbox schedules and Experiments use ([connections](connections.md#event-lifecycle), [agent-lifecycle](agent-lifecycle.md#trigger-fire)). The event survives the pod not being up yet — including an agent parked over budget — and is delivered once the agent is Ready. agent-runtime runs the command in the workspace, in the pod's environment, so egress rides the paired gateway exactly as a harness process would. It runs once: the plugin writes a sentinel on success, so a redelivery (or a pod killed mid-run before the outbox settled) never double-runs a completed install. A failed run stays pending and retries on the next wake until it succeeds or the event's TTL lapses.
3. **Wake**, so the freshly created agent comes up and runs the bootstrap before the user does anything. No session is opened and no turn runs — the command mutates the workspace, then the user chats with the ready-made knowledge base.

The module has no persistence of its own: a Knowledge Base is exactly the owner's Agent plus the marker, and deleting the agent deletes the Knowledge Base.

## UI

Knowledge Bases is a feature-gated destination ([features](features.md)) with a list, a single-page create form, and a **standalone per-KB page** — the chat surface under the knowledge base's own route, so the rail keeps the Knowledge Bases context and leaving returns to the KB list, never to Sandboxes. Lifecycle actions (wake, restart, pause, stop, delete) are the standard agent actions.

## Where the code lives

- Contract: [`packages/api-server-api/src/modules/knowledge-bases/`](../../packages/api-server-api/src/modules/knowledge-bases/)
- Implementation: [`packages/api-server/src/modules/knowledge-bases/`](../../packages/api-server/src/modules/knowledge-bases/)
- Kind marker plumbing: [`packages/api-server/src/modules/agents/`](../../packages/api-server/src/modules/agents/)
- UI destination: [`packages/ui/src/modules/knowledge-bases/`](../../packages/ui/src/modules/knowledge-bases/)
