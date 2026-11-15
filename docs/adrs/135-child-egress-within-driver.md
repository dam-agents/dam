---
id: 135
title: A sub-agent or Environment reaches no more than its driver unless the owner agreed
status: accepted
subsystem: security-and-credentials
tags: [invocations, environments, egress, hitl]
summary: A driver's rule that lets its child make a request the driver's own rules do not allow waits for the owner, until the owner turns on one switch per agent that lets its sub-agents and Environments have network access of their own.
---

# ADR-135: A sub-agent or Environment reaches no more than its driver unless the owner agreed

**Date:** 2026-11-10 **Status:** Accepted **Owner:** @jjeliga

## Context

A driver can give a sub-agent or Environment rules of its own that the driver sets, with no prompt except for a wildcard host, and it can copy files into a kept child over the link.
Together they lift the driver's own limits: a driver with narrow network access fetches data through its connections, copies it into a child whose rules reach any host it names, and the child sends it there (#6413).
Blocking such children altogether is not an answer: an Environment per pull request usually needs the internet.

## Decision

A child never makes a request its driver's own rules do not allow, unless the owner agreed; the owner agrees once per agent, not per child.

- An allow rule a driver sets on its child is **wider** when it lets through a request (a host, port, method and path) the driver's own rules, as they are at that moment, do not allow; one such rule is enough.
  Methods and paths are compared, so a driver its owner limited to reading one path of a host cannot give its child the rest of that host.
  A doubt is read as wider.
  The check runs at launch and every time the driver replaces the child's rules.
- A wider rule waits for the owner's approval, as a wildcard rule does, and the child's other rules apply meanwhile.
  The driver is told which rules wait, at launch and at every update, on the tool and the SDK alike.
- Each agent has one switch, off by default and offered with Environments: its sub-agents and Environments may have network access of their own.
  On, the driver sets wider rules with no prompt.
  The owner flips it in the agent's network settings, or by approving a wider rule "for all sub-agents and Environments", an explicit choice on the request.
  A plain approval writes that one rule and leaves the switch as it is, so an owner never turns the switch on without saying so.
  Turning it on also writes every rule that waits for it under that agent.
- Only the switch of the agent at the root of a launch chain counts, so a child never gives its own children more than the owner allowed at the root.
- A wildcard rule waits for the owner each time, with the switch on or off.
- A block the owner set on a child (a deny, from refusing one of the child's own requests forever or written by hand) is the owner's alone.
  The driver cannot revoke it by replacing the child's rules, and its allow that the gate would rank before the block is not written and not asked of the owner again; the driver is told it was blocked.
  A block of a wildcard says "not any host", so a host under it is still the reach check's to decide.
- Replacing a child's rules takes back only the driver's own rules and the owner's approvals of what the driver asked.
  An approval stays the owner's rule while the driver still names it, with the switch on or off; the platform's own rule and a rule the owner wrote by hand stay whatever the driver sets.

## Alternatives Considered

- **No child wider than its driver, ever** — an agent with narrow access could not create an Environment per pull request that reaches the internet.
- **Ask for every wider child** — the common case, one Environment per pull request, would prompt the owner each time.
- **A switch per Environment** — the risk is the driver's, not one child's, so a per-child answer would be asked again for each child.
- **Compare hosts and ports only** — a driver limited to `GET` on one path of a host could give its child every method and path of it, with no prompt.
- **Turn the switch on with the first approval** — an owner who meant to allow one host would have allowed every later one without knowing.
- **Let the driver replace the owner's blocks with the rest of the child's rules** — an agent could undo a block its owner chose.

## Consequences

- **Easier:** a driver can no longer move data it fetched to a host the owner never let it reach through a child it launched.
- **Harder:** an agent that launches children for software that needs the internet waits for an approval per rule, until the owner turns the switch on, ahead of time or from a request.
- **Harder:** a driver that narrows its own rules later leaves its children's earlier rules as they were; the check runs only when the driver sets a child's rules.
- **Committed-to:** the comparison reads the driver's rules the way the egress gate does, so a change in how the gate matches hosts, ports, methods or paths must change it too.
