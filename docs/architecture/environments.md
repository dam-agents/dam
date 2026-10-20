# Environments

Last verified: 2026-10-19

## Overview

An **Environment** is a sandbox an Agent creates and controls to run software for other people and agents to open — typically one per pull request, running its build.
The Agent that creates it is its **Owning Agent**.
Users see an Environment as its own kind of thing under its agent, never as an agent: it is left out of every agent list, picker and count.
The api-server's agent list leaves it out, so the app, the CLI and an API key's agent picker never show it; it is still found by id.

The feature is behind the per-user `environments` [feature](features.md), offered only on an install that runs microVMs.

## What an Environment is

Underneath, an Environment is an ordinary Agent record with one more field, `environmentOf`, naming the Owning Agent.
The cluster refuses to add, remove or change that field after create, and refuses it on any backend but `vm`.
So an Environment runs on its owner's [VM runner](vm-runner.md), beside its Owning Agent, and every other part of the platform treats it as a vm Agent: its gateway, wake and sleep, budget and storage pool, relays and telemetry.

It is created with nothing that would let it act as its Owning Agent:

- **No harness.** The machine is told it is an Environment (`PLATFORM_ENVIRONMENT_OF`, set after the owner's own secret, so neither an ordinary Agent's secret can make it one nor the reverse); its runtime starts no chat harness and no session-history workers, and refuses chat and terminal connections.
- **No connections** and no default model provider, and no egress preset.
- **The platform's default image**, with Docker, k3s and openrc; the software it runs goes inside, as containers or processes.

A row in the `environments` table holds what only this module reads: its name among the Owning Agent's Environments, its host label, its endpoints, the access list, and its expiry.

## Lifecycle

- **Create.** Only a vm Agent can own Environments; an Environment cannot own one.
  An agent holds at most `environments.maxPerAgent` of them (default 5), each name once.
  The Agent is named `<owning agent> · <name>`, which keeps it unique among the owner's agents.
  If the row cannot be written, the Agent is deleted again.
- **Start.** A `start` command is delivered once, as a workspace command, that writes it as a [Startup Item](agent-processes.md#startup-items), an openrc user service, which then runs at every boot.
- **Sleep.** An Environment sleeps like any vm sandbox, after the install's idle time, and keeps its disk; there is no setting of its own.
- **Expiry.** Every Environment has an expiry, a week by default and at most `environments.expiryMaxDays` ahead (default 30); a later date is cut to the maximum.
  The Owning Agent and the owner set and extend it, and a sweep every five minutes deletes an Environment whose expiry passed.
- **Delete.** The Owning Agent or the owner deletes an Environment at any time; it goes through the agents service, so the Agent's own cleanup runs.
  Deleting an Owning Agent deletes its Environments through the same cleanup, and the periodic sweep of agent artifacts catches any left behind.

## The Environment Link

The Owning Agent reaches each of its Environments over SSH, joined by their [VM runner](vm-runner.md) through a vsock port of each machine, never through the api-server or the pod network.
The link is one-way: only the Owning Agent's machine can open it, the runner joins it only to an Environment that names that machine as its owner, and nothing in an Environment can open a connection back.

- **`ssh env-<name>`** works from the Owning Agent with nothing to set up: the image's SSH config sends every `env-*` host through `platform-env proxy`, which finds the Environment by name with the `list_environments` tool, wakes it with `wake_environment` when it sleeps, and opens the link.
  `scp`, `ssh -L` and streaming an image in, `docker save IMAGE | ssh env-<name> k3s ctr images import -`, work as with any host.
- **No key to copy.** The proxy sends the agent's link key over the link before SSH starts, and the Environment trusts it until it next boots; only the Owning Agent reaches the link, so the link itself is the authorization.
- **On the Environment**, an openrc service of the image, `platform-env`, runs `socat` on the vsock port, which hands each connection to a short script that trusts the key and runs `sshd -i`; it starts only on a machine that is an Environment.
  A shell gets the gateway and CA settings an openrc service gets, so `docker` and `k3s` pull as they do at boot.
- **An open link keeps both machines awake.** Every process of a link, the proxy on the agent and `sshd` on the Environment, carries `PLATFORM_LINK`, and the runtime reads as busy while one runs.

The agent's side is a small Python helper, since Node has no vsock, and both sides carry the bytes with `socat`.

## Addresses

Each endpoint an Environment declares (`app` → 4444) gets an address of its own: `<endpoint>-<host>` under the install's environments domain (`environments.domain`), so each is its own origin and no Environment can read another's cookies or storage.
The **host label** is the Environment's name with a random suffix, so two Agents can both create `pr-42`, and is short enough that the longest endpoint name still fits the 63 characters of a DNS label.
Endpoint names carry no hyphen, so the first hyphen of an address splits the endpoint from the host.
Without `environments.domain` Environments have no addresses.

## Surfaces

**The Owning Agent** uses five platform MCP tools — `create_environment`, `list_environments`, `update_environment`, `wake_environment`, `delete_environment` — offered only to a vm Agent that is not an Environment, while its owner has the feature on, and `platform-env` in the image, which lists them and opens the [Environment Link](#the-environment-link).
They act on the calling Agent's Environments alone, found by name.

**The owner** lists an agent's Environments and extends or deletes one through the `environments` tRPC router, under the same scopes as the agent's own management.

The security log records each create and delete, naming the Owning Agent or the owner.
