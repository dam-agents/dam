---
id: 126
title: Only people decide who opens an Environment, by adding to lists that never narrow
status: accepted
subsystem: environments
tags: [environments, sharing, access]
summary: Who may open an Environment is the union of its owner, the agent's editors, the agent's Agent Environment Members and the Environment's own Environment Members; only people set either list, the agent sets none, and no list narrows another.
---

# ADR-126: Only people decide who opens an Environment, by adding to lists that never narrow

**Date:** 2026-11-02
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-109

## Context

ADR-109 made the owner's list per agent the most people who could open an Environment, and let the owning agent narrow it for one Environment.
That gave the agent, which reads untrusted text, a say in who opens what it runs, while artifacts already let only a person decide who may open a restricted link.
It also gave the owner no way to add one person to one Environment, and Environments moved into the Artifacts list, where the owner expects to share each item from its own Share dialog.

## Decision

Who may open an Environment is the union of four groups, read at each request: its owner, the agent's editors, the agent's **Agent Environment Members**, and the Environment's own **Environment Members**.
No list narrows another, and an Environment is never public.

- **Only people set either list.** The owner and the agent's editors name the agent's members; the owner adds people to one Environment in its Share dialog.
  The agent sets neither: its tools refuse who-may-open, and tell it only how many people may, never who.
- **The agent's list is never copied** into its Environments, so a change reaches every one of them at the next request.
- **Members, not viewers**: a person who opens an Environment uses a live app, destructive actions included.
- Each list is rows of one person each, as an agent's editors and an artifact's viewers are.

This replaces ADR-109's "owner's list as the ceiling" and the agent's narrowing; the rest of ADR-109 stands.

## Alternatives Considered

- **Keep the agent's narrowing** — the agent acts on prompts anyone may write, which the artifact library already refuses to trust with sharing.
- **One list per Environment, nothing per agent** — every new Environment would start closed, and the owner would share each one by hand.
- **Let the agent add people from the owner's list** — gives no one access the agent's list does not already give.
- **Narrowing set by a person** — no use for it has come up, and the Share dialog would have to explain a list that removes people.

## Consequences

- **Easier:** the owner adds one person to one Environment without opening all of them; a prompt the agent reads cannot change who opens its apps.
- **Harder:** an Environment cannot be closed to someone on its agent's list; Environments an agent had narrowed open to the whole list once this ships, which the release notes have to say.
- **Committed-to:** the union of four groups as the gate's rule, and no agent-facing control over it; giving the agent one back means reopening this record.
