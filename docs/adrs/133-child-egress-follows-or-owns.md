---
id: 133
title: A sub-agent's or Environment's network access follows its driver, or is its own
status: accepted
supersedes: 078
subsystem: security-and-credentials
tags: [invocations, environments, egress, hitl]
summary: By default a sub-agent or Environment uses its driver's network rules, as before; the driver may instead give it rules of its own, either rules the driver sets, or a copy of some of the driver's rules that only a person can widen.
---

# ADR-133: A sub-agent's or Environment's network access follows its driver, or is its own

**Date:** 2026-11-06 **Status:** Accepted **Owner:** @jjeliga

## Context

Until now a sub-agent had no network rules of its own: every request it made was allowed or denied by its driver's rules (ADR-078).
Sub-agents and Environments are now one kind of sandbox, and drivers use them for different work: building and serving software, or running a task that should reach less, or other, hosts than the driver itself.
A sandbox that can only ever use its driver's rules can't be locked down for untrusted work, nor opened up for a throwaway job without the user reviewing every request.

## Decision

When a driver launches a sub-agent or an Environment, it picks which rules decide the child's network requests, and that choice stays for the child's whole life:

- **The driver's rules** (the default, as before): the child uses the driver's rules as they are at the time, so any change to them applies to the child too.
- **Rules set by the driver ("open"):** the child gets rules of its own, which the driver sets at launch and can replace at any time; any host they don't allow is denied, and no person is asked.
  The one exception is access to any host, or to a whole top-level domain such as `.com`: that rule is never the driver's to give; it waits as a request to the owner, and only a person's approval adds it.
- **A copy the user widens ("scoped"):** the child starts with a copy of the driver's rules for the hosts the driver names, and the copy doesn't follow later changes.
  A request to any other host waits for a person, never the driver, shows on the driver's page naming the child, and approving it widens the child's rules only.

The rules change after launch; the choice between the three doesn't.

Also:

- A child of a sub-agent with rules of its own uses that sub-agent's rules, not the top driver's.
- Credentials stay per child: a child only ever sends credentials for the connections it holds itself, whichever rules decide its requests.
- An Environment with rules of its own is decided by those rules, not its owning agent's.

## Alternatives Considered

- **Always the driver's rules (ADR-078)** — no way to lock a sandbox down, and no sandbox the user doesn't have to review.
- **The driver approves a scoped child's requests** — a driver could then widen its own reach through a child it launched.
- **The child's rules first, falling back to the driver's** — every request would have two possible answers, which ADR-078 already rejected.

## Consequences

- **Easier:** a driver can run untrusted work under a narrow copy of its rules, and a throwaway sandbox under rules of its own, without the user reviewing each request.
- **Harder:** the hosts an open child may reach are the driver's call, with no prompt except for access to any host or a whole top-level domain; data the driver copies into such a child can reach any host the driver allows without the user seeing it.
- **Harder:** each child with rules of its own is one more set of rules to look after; they are listed on the driver's network rules page.
- **Committed-to:** every request a sub-agent makes is checked against the right set of rules by walking up its chain of drivers, so that chain has to stay correct.
