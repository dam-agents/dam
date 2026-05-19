# DRAFT: Multi-agent collaboration — isolated Agents with shared artifacts

**Date:** 2026-04-07
**Status:** Proposed
**Owner:** @tomkis

## Context

As agent use cases mature beyond single-agent coding tasks, users want multiple specialized agents collaborating — e.g., one agent on Telegram handling family logistics, another on Slack managing work tasks, each with different system prompts, skills, and credential access.

OpenClaw demonstrates this with its multi-agent configuration file, where agents share a single mutable system environment and permissions are enforced partly via prompts. This works for personal use but is problematic for enterprise: mutable shared state, prompt-based security boundaries, and no enforceable isolation between agents.

The question: how should Platform model multi-agent collaboration? Should agents share workspaces, run inside a single Agent, or be fully isolated with explicit communication channels?

## Decision

**Each agent is its own pod, modelled as its own [Agent resource](046-eliminate-instance.md) — own definition, own runtime state, own lifecycle. Agents collaborate through explicitly shared artifacts, not shared workspaces.**

Multi-agent is NOT sub-processes within a single Agent. Each agent gets:

- Its own Agent (own pod, own ephemeral container per ADR-012)
- Its own persistent workspace volume (per ADR-001)
- Its own credential/permission scope — one Agent may have GitHub access, another may not (per ADR-005)
- Its own system prompt and skill configuration

Inter-agent communication uses a platform-level **shared artifact mechanism**: the user explicitly declares which artifacts (files, folders) are shared between which Agents. This is analogous to sharing a Google Drive folder between employees rather than giving them access to each other's computers.

The platform DOES:
- Allow the user to declare shared artifact mounts between Agents
- Enforce per-Agent credential scoping (credentials are per-Agent, not per-Template)
- Maintain full isolation between Agents by default — sharing is opt-in

The platform does NOT:
- Run multiple agents inside a single Agent/pod
- Allow Agents to mount each other's full workspaces
- Rely on prompt-level enforcement for inter-agent boundaries

## Alternatives Considered

**Shared workspace between Agents.** Mount one Agent's workspace into another. Rejected: violates separation of concerns. Agents should have clearly defined contracts (artifacts) for what they exchange, not unrestricted access to each other's state. This mirrors how teams work — you share a document, not your entire laptop.

**Multi-agent within a single Agent.** Run multiple agent processes in one pod with a shared filesystem. Rejected: conflates isolation boundaries, makes per-Agent credential scoping impossible at the platform level, and creates the same mutable-state problems seen in OpenClaw.

**OpenClaw-style config-file multi-agent.** Single configuration file defining all agents, shared environment, prompt-based permissions. Rejected: prompt-based security is not enforceable — an agent can ignore prompt instructions. Enterprise environments require platform-enforced boundaries. Platform's advantage is platform-level fine-grained control.

## Consequences

- **Stronger isolation by default.** Each Agent is sandboxed; compromise of one Agent doesn't cascade.
- **Per-Agent credential scoping required.** Current OneCLI integration configures credentials per-Template; this needs to move to per-Agent. Requires changes to how OneCLI connectors are registered.
- **Shared artifact mechanism is new work.** The platform needs a first-class concept of shared mounts between Agents — likely a new field in the Agent ConfigMap spec.
- **No implicit agent-to-agent communication.** Agents can't "discover" each other unless the user explicitly configures shared artifacts. This is intentional but means orchestration is the user's responsibility for now.
- **Aligns with employee mental model.** Users think of Agents as employees they're hiring — each with their own role, permissions, and shared folders. This maps cleanly to the Agent-per-agent model.
