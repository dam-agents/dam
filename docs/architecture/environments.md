# Environments

Last verified: 2026-10-21

## Overview

An **Environment** is a sandbox an Agent creates and controls to run software for other people and agents to open — typically one per pull request, running its build.
The Agent that creates it is its **Owning Agent**.
Users see an Environment as its own kind of thing under its agent, never as an agent: it is left out of every agent list, picker and count, and the sidebar lists it under its Owning Agent as an Environment.
The api-server's agent list leaves it out, so the app, the CLI and an API key's agent picker never show it; it is still found by id.

The feature is behind the per-user `environments` [feature](features.md), offered only on an install that runs microVMs.

## What an Environment is

Underneath, an Environment is an ordinary Agent record with one more field, `environmentOf`, naming the Owning Agent.
The cluster refuses to add, remove or change that field after create, and refuses it on any backend but `vm`.
So an Environment runs on its owner's [VM runner](vm-runner.md), beside its Owning Agent, and every other part of the platform treats it as a vm Agent: its gateway, wake and sleep, budget and storage pool, relays and telemetry.

It is created with nothing that would let it act as its Owning Agent:

- **No harness.** The machine is told it is an Environment (`PLATFORM_ENVIRONMENT_OF`, set after the owner's own secret, so neither an ordinary Agent's secret can make it one nor the reverse); its runtime starts no chat harness and no session-history workers, and refuses chat and terminal connections.
- **No connections** and no default model provider, and no egress preset: it holds no credential, and a grant on it is refused.
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
- **An open link keeps both machines awake.** The proxy on the agent and the script `socat` starts for the connection on the Environment carry `PLATFORM_LINK` from their start, and the runtime reads as busy while one runs; it reports one link per marked tree, not per process.

The agent's side is a small Python helper, since Node has no vsock, and both sides carry the bytes with `socat`.

## Network access

An Environment runs the app its agent built, which reaches registries, mirrors and models, and it runs untrusted code for visitors, so it never carries the Owning Agent's credentials.

- **Egress follows the Owning Agent's rules.** The egress gate resolves an Environment to its Owning Agent, of the same owner, and decides by the Owning Agent's rules: a host the agent may reach, the Environment may reach; a host denied stays denied.
  The hosts the Owning Agent's path-scoped rules promote to inspection are inspected on the Environment's gateway too, within five minutes of a new Environment or a newly narrowed rule, so those rules hold there.
- **A new host** files one approval as the Owning Agent's, which names the Environment it came from, on the owner's Home; the verdict becomes the Owning Agent's rule, for the agent and all its Environments.
- **Connections.** An Environment holds none: granting the owner's connections on one (for example a model for a nested platform) is not built yet, because a granted connection's rules would be written under the Environment while its egress is decided under the Owning Agent.
  A grant on an Environment is refused for every caller, so the Owning Agent cannot pass its own connections on, and a newly connected provider is never given to one.

## Addresses

Each endpoint an Environment declares (`app` → 4444) gets an address of its own: `<endpoint>-<host>` under the install's environments domain (`environments.domain`), so each is its own origin and no Environment can read another's cookies or storage.
The **host label** is the Environment's name with a random suffix, so two Agents can both create `pr-42`, and is short enough that the longest endpoint name still fits the 63 characters of a DNS label.
Endpoint names carry no hyphen, so the first hyphen of an address splits the endpoint from the host.
Without `environments.domain` Environments have no addresses.

**One wildcard Ingress** for `*.<environments.domain>`, which the chart renders with the domain, sends every address and the sign-in host `signin.<environments.domain>` to the api-server.
It carries one wildcard certificate, from `environments.ingress.tls.secretName`, which cert-manager can issue through an issuer with a DNS-01 solver named in `environments.ingress.annotations`; on OpenShift the Ingress becomes a wildcard Route, which the cluster allows once with `WildcardsAllowed`.
The local cluster serves `*.env.localhost` over plain HTTP.

**The gate.** The api-server reads the Environment and endpoint from the host name, before any other route, and relays HTTP and WebSocket to the Environment's runtime, which forwards to that endpoint's port on the Environment's own loopback and nowhere else.
The api-server names the declared ports on every request, so a port the Environment did not declare is refused, and so are the runtime's own ports.

- **Who may open it.** The owner keeps a list of people per agent, by email, which every Environment of that agent inherits; the owner is always in, and an empty list means only the owner.
  The Owning Agent can narrow the list for one Environment (`access`), never widen it: an email off the owner's list is refused, and the agent cannot read the owner's list.
  A visitor matches by the email their identity provider verified, compared trimmed and lowercased; an account without one matches nobody's list.
  A visitor who may not open it gets a page naming the account they are signed in with and telling them whom to ask.
- **Sign-in** happens once, on the sign-in host, with an identity provider client of its own whose tokens the platform's API refuses.
  The sign-in host hands the address the visitor came from a code that works once, for that address only, within a minute, and the address trades it for a session cookie of its own: `__Host-platform-env` over HTTPS, scoped to that one origin, so no other Environment can set or read it.
  Every address reserves `/.platform/` for the hand-off and sign-out, which never reach the app.
- **Cookies and headers.** The relay never passes on the platform's session cookie or an `Authorization` header, passes on every cookie the app set itself, and never lets the app set the session cookie.
  An app's cookie loses its `Domain` attribute, so it stays on the address that set it, and a WebSocket handshake passes no `Set-Cookie` at all.
  The original host and scheme go on as `X-Forwarded-Host` and `X-Forwarded-Proto`.
- **Wake.** A request to a sleeping Environment wakes it and waits until its runtime answers, not until the app does: a request that comes before the app listens gets the gate's "not answering" page, and the visitor tries again.
  Requests refresh its activity at most once a minute, and no open connection holds it awake, so a forgotten tab lets it sleep.
- **Every response is uncacheable**, and the security log records each new session and each refusal.

## Surfaces

**The Owning Agent** uses five platform MCP tools — `create_environment`, `list_environments`, `update_environment`, `wake_environment`, `delete_environment` — offered only to a vm Agent that is not an Environment, while its owner has the feature on, and `platform-env` in the image, which lists them and opens the [Environment Link](#the-environment-link).
They act on the calling Agent's Environments alone, found by name.

**The owner** lists an agent's Environments, extends or deletes one, and reads and sets the agent's list of people through the `environments` tRPC router, under the same scopes as the agent's own management.
In the app, a vm agent's page has an **Environments** section, behind the feature: the list of people who may open its Environments, at most 50, edited once it has loaded, and a row per Environment with each endpoint's link, whether it runs, its expiry, how many of the list may open it, and the owner's controls to extend and delete it.
What an Environment runs, its Startup Items and their output, is not shown there yet.
The sidebar lists an agent's Environments under it, once it is expanded: a row each, with whether it runs, that opens the Environments section, and a link per endpoint that opens the app in a new tab.
The owner creates none there; the agent does.

The security log records each create and delete, naming the Owning Agent or the owner, each change to an agent's list of people, each new session with the person's email, and each refusal.
