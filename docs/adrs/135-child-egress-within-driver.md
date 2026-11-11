---
id: 135
title: A sub-agent or Environment reaches no more than its driver unless the owner agreed
status: accepted
subsystem: security-and-credentials
tags: [invocations, environments, egress, hitl]
summary: A driver's rule that lets its child reach a host the driver itself cannot reach waits for the owner, until the owner turns on one switch per agent that lets its sub-agents and Environments have network access of their own.
---

# ADR-135: A sub-agent or Environment reaches no more than its driver unless the owner agreed

**Date:** 2026-11-10 **Status:** Accepted **Owner:** @jjeliga

## Context

A driver can give a sub-agent or Environment rules of its own that the driver sets, with no prompt except for a wildcard host, and it can copy files into a kept child over the link.
Together they lift the driver's own limits: a driver with narrow network access fetches data through its connections, copies it into a child whose rules reach any host it names, and the child sends it there (#6413).
Blocking such children altogether is not an answer: an Environment per pull request usually needs the internet.

## Decision

A child never reaches a host and port its driver cannot reach, unless the owner agreed; the owner agrees once per agent, not per child.

- An allow rule a driver sets on its child is **wider** when it lets through a host and port the driver's own rules, as they are at that moment, do not; one such rule is enough.
  Methods and paths are not compared.
  The check runs at launch and every time the driver replaces the child's rules.
- A wider rule waits for the owner's approval, as a wildcard rule does, and the child's other rules apply meanwhile.
- Each agent has one switch, off by default and offered with Environments: its sub-agents and Environments may have network access of their own.
  On, the driver sets wider rules with no prompt.
  The owner flips it in the agent's network settings, or by approving the first wider rule; there is no one-time mode.
- Only the switch of the agent at the root of a launch chain counts, so a child never gives its own children more than the owner allowed at the root.
- A wildcard rule waits for the owner each time, with the switch on or off.
- A block the owner set on a child (a deny, from refusing one of the child's own requests forever or written by hand) is the owner's alone.
  The driver cannot revoke it by replacing the child's rules, and its allow that the gate would rank before the block is not written and not asked of the owner again; the driver is told it was blocked.
  A block of a wildcard says "not any host", so a host under it is still the reach check's to decide.

## Alternatives Considered

- **No child wider than its driver, ever** — an agent with narrow access could not create an Environment per pull request that reaches the internet.
- **Ask for every wider child** — the common case, one Environment per pull request, would prompt the owner each time.
- **A switch per Environment** — the risk is the driver's, not one child's, so a per-child answer would be asked again for each child.
- **Compare methods and paths too** — a child would wait for the owner over a path its driver could already reach on that host.
- **Let the driver replace the owner's blocks with the rest of the child's rules** — an agent could undo a block its owner chose.

## Consequences

- **Easier:** a driver can no longer move data it fetched to a host the owner never let it reach through a child it launched.
- **Harder:** an agent that launches children for software that needs the internet waits for one approval before the first child works, or the owner turns the switch on ahead of time.
- **Harder:** a driver that narrows its own rules later leaves its children's earlier rules as they were; the check runs only when the driver sets a child's rules.
- **Committed-to:** the comparison reads the driver's rules the way the egress gate does, so a change in how the gate matches hosts or ports must change it too.
