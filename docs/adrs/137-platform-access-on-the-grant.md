---
id: 137
title: An agent's access to the platform is stored on its grant and presented with its own key
status: accepted
supersedes:
subsystem: connections
tags: [platform-connection, agent-key, authorization]
summary: An agent calls the platform API with its own Agent Key, and what it may do is a list of entries on its grant of the platform Connection, shaped like rich authorization requests, with a reach of own or all; an agent has a permission only when an entry names it, and it can never change its own access.
---

# ADR-137: An agent's access to the platform is stored on its grant and presented with its own key

**Date:** 2026-11-27 **Status:** Accepted **Owner:** @jezekra1

## Context

An agent that holds the platform Connection uses one owner API key with every scope, shared by all agents that hold it.
The platform cannot tell which agent calls, cannot give one agent less than another, and cannot hold an agent to what it created.
Agents therefore reach the platform through about seventy separate tools, and replacing those with the CLI needs a credential that is safe to give to every agent.

## Decision

An agent calls the platform API with its own Agent Key, which says who is calling; what the agent may do is its **Platform Access**, stored on its grant of the platform Connection and read on every request.

- **Shape.** A Platform Access is a list of entries with the fields of a rich authorization request (RFC 9396): `type`, `locations` and `actions` with their meaning there, and `reach` as a field of our own.
  The platform stores and enforces it; the identity provider is not involved.
- **Named, or not allowed.** An agent has a permission only when an entry names it, entries add up, and there are no deny entries.
  A wildcard is written out, so an entry that leaves a field out is refused.
- **Reach.** Own is the agent itself and what it created; all is everything its owner has in that area.
- **One level.** An agent creates helper agents and Apps; a created agent creates neither.
- **No self-widening.** An agent never changes its own reach, connections, network rules, spend limit, editors or channel bindings, at any setting; only a signed-in owner sets a Platform Access.
- **Closed by default.** Every procedure is closed to an agent caller unless a list names it.
- **One hidden mode.** The platform gives the assistant, and no other agent, the owner's own key; nothing else can set it.

## Alternatives Considered

- **Tokens from the identity provider** — the Keycloak we ship (26.5) has no resource indicators, exchanges only its own tokens and has no general rich authorization requests; agents hold no such token, and it cannot narrow a GitHub or Slack credential.
- **More scopes on the owner API key** — the key still names the owner alone, so "what this agent created" cannot be checked.
- **A missing area means own** — an owner could not switch an area off, and the stored value would not say what the agent may do.
- **Whole-tree ownership** — every agent above a compromised helper could drive it, and deleting an agent would have to delete the tree below it.
- **A second mode any owner can pick** — "all agents" with the right to grant connections is the owner's access under another name.

## Consequences

- **Easier:** per-agent access is one concept across connections: MCP tool access already lives on the grant, and GitHub narrowing can move there in the same shape.
- **Easier:** a change takes effect on the agent's next request with no key to reissue, because the key carries identity alone.
- **Harder:** every route that authorizes by "the caller owns this agent" must refuse an agent caller, because such a caller carries its owner's subject; about a dozen routes beside tRPC do today.
- **Harder:** an agent's Agent Key exists only on an install that serves Apps and while the agent may reach them, so the key must be issued independently before every agent can act as itself.
- **Committed-to:** the list of procedures open to an agent caller, and the rule that only a signed-in owner sets a Platform Access.
