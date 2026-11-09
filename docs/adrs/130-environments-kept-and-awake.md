---
id: 130
title: An Environment can be kept with no expiry and kept awake
status: accepted
subsystem: environments
tags: [environments, lifecycle, hibernation]
summary: An Environment's owner and its Owning Agent may each turn off its expiry and its sleep when idle, the last change winning, so a server people rely on neither disappears nor fails while it wakes; the cap per agent still bounds how many an agent holds.
---

# ADR-130: An Environment can be kept with no expiry and kept awake

**Date:** 2026-11-05 **Status:** Accepted **Owner:** @jezekra1 **Amends:** ADR-109

## Context

ADR-109 bounded the install's load with a cap per agent and an expiry on every Environment, and let it sleep like any vm sandbox; a later setting made it always sleep in the end, after at most a day.
Agents now build servers a team relies on, such as an MCP server people connect their clients to (#6318).
Such a server is deleted within 30 days at most, and a client that calls it while it wakes gets an error.

## Decision

An Environment's expiry and its sleep when idle can each be turned off.

- **No expiry.** The owner, in the Artifacts list, and the Owning Agent, through its tools, may keep an Environment until someone deletes it. The install's maximum expiry does not bound it, and no install-wide switch turns the choice off.
- **Never sleeps.** The Owning Agent, through its tools, and the owner, in the Artifacts list, may keep it awake, so the platform never puts it to sleep for being idle, and the memory reclaim does not either; the owner lets it sleep again the same way. The install's maximum idle timeout does not bound it.
- **The last change wins**, whoever made it, owner or agent: both spend the owner's own runner.
- **The cap per agent** still counts every Environment, kept and awake ones too.
- A date, a timeout and the defaults work as before; an Environment is kept or awake only when someone asks for it.

## Alternatives Considered

- **An address that outlives one Environment** — a second, stable name to route and to secure, for a need that turning off the expiry already meets.
- **Only the owner may turn them off** — the owner asks the agent in chat to create a server that stays up, and would have to repeat the choice in the app.
- **Only the agent may keep it awake** — the owner pays for the memory and could not take it back short of deleting the Environment.
- **An install-wide switch** — the cost lands on the owner's own runner, which the owner already chose to spend; one more setting to keep in step for no protection the cap does not give.
- **Wake on the first request and hold it** — still fails a client whose call outlasts the wake, which takes minutes for an app on k3s; it complements, not replaces, staying awake.

## Consequences

- **Easier:** a team uses a server an agent built for as long as it needs, with no agent or person extending it every month and no wake on the first call.
- **Harder:** an awake Environment holds its memory on the owner's runner all the time, so fewer of the owner's agents fit before admission refuses one; a kept Environment holds its disk until someone deletes it, and nothing reminds anyone of it.
- **Committed-to:** an Environment's row may carry no expiry, which the expiry sweep skips, and a zero idle timeout means never sleeping, as the controller already reads it.
