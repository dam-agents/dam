---
id: 132
title: One agent-to-agent link, accepted by the platform's guest init on any image
status: accepted
subsystem: vm-runner
tags: [vm, environments, sub-agents, ssh, link]
summary: The accepting end of the link between agents' machines runs in the platform's own guest init as an SSH server with sftp, on any image, and a machine may accept the link from the one agent named for it while opening links of its own.
---

# ADR-132: One agent-to-agent link, accepted by the platform's guest init on any image

**Date:** 2026-11-04 **Status:** Accepted **Owner:** @jjeliga

## Context

A driver needs to work inside its sub-agent: copy files in, start work, copy results out.
The only path into another agent's machine is the Environment Link, and it has two limits.
Its accepting end is part of the platform image (an init service, a socket relay and the image's own SSH daemon), so a machine on any other image cannot accept it, though a kit and a spawn may each bring their own image.
And a machine either opens links or accepts one, never both, so a sub-agent its parent could enter could no longer reach Environments of its own.

## Decision

The accepting end of the link between agents' machines runs in the platform's own guest init from the runner release, not in the image, as an SSH server with built-in sftp.
A machine may both accept the link from the one agent named for it and open links of its own: an Environment accepts from its owning agent, and a sub-agent accepts from its parent and still reaches its own Environments.

- The runner still joins two machines only in one direction, from the dialing agent to a machine that names that agent; nothing else reaches a machine over the link.
- The dialer's protocol stays as it is: it names the target, then sends its public key, which the accepting machine trusts for that boot only.
- What the image must provide shrinks to a shell for commands to run in; file transfer works without one.
- The owner keeps reaching any machine through the api-server's SSH relay; this link is between agents.

## Alternatives Considered

- **Keep the accepting end in the image** — an image a kit or a spawn brings has no link, and every such image would need the same service.
- **A static Dropbear in the runner release** — a C cross-build for two architectures beside a Rust-only release, and no sftp of its own.
- **A second link kind for sub-agents** — two mechanisms joining the same machines for the same job.
- **Allow the link only on the platform image** — kits and spawns may bring their own image, so their machines could never be entered.

## Consequences

- **Easier:** a parent reaches its own sub-agent, which today is refused ("is not an Environment of"), and a machine on any image accepts the link, since the guest init already runs in every machine whatever its image.
- **Easier:** one link serves Environments and sub-agents, so who may enter which machine stays one rule in one place, the runner.
- **Harder:** the guest init now carries an SSH implementation and its cryptography, so it grows, and a security fix in it ships with a runner release rather than an image rebuild.
- **Harder:** the image's own SSH daemon settings no longer apply to the link; the environment a link session gets (PATH, proxy and CA variables) is the init's to pass, as the image's service passed it before.
- **Committed-to:** the guest vsock ports of the link are a contract between the runner and the guest init, fixed for every machine, because smolvm numbers published sockets by their order.
- **Committed-to:** one named agent may link into a machine; a second would change who the runner admits.
