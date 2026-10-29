# Environments

Last verified: 2026-10-27

## Overview

An **Environment** is a sandbox an Agent creates and controls to run software for other people and agents to open — typically one per pull request, running its build.
The Agent that creates it is its **Owning Agent**.
Users see an Environment as its own kind of thing under its agent, never as an agent: it is left out of every agent list, picker and count, and shows only with its Owning Agent, as an Environment.
The api-server's agent list leaves it out, so the app, the CLI and an API key's agent picker never show it; it is still found by id.

The feature is behind the per-user `environments` [feature](features.md).

## What an Environment is

Underneath, an Environment is an ordinary Agent record with one more field, `environmentOf`, naming the Owning Agent.
The cluster refuses to add, remove or change that field after create.
So an Environment runs on its owner's [VM runner](vm-runner.md), beside its Owning Agent, and every other part of the platform treats it as an Agent: its gateway, wake and sleep, budget and storage pool, relays and telemetry.

It is created with nothing that would let it act as its Owning Agent:

- **No harness.** The machine is told it is an Environment (`PLATFORM_ENVIRONMENT_OF`, set after the owner's own secret, so neither an ordinary Agent's secret can make it one nor the reverse); its runtime starts no chat harness and no session-history workers, and refuses chat and terminal connections.
- **No connections** and no default model provider, and no egress preset: it holds no credential, and a grant on it is refused.
- **The platform's default image**, with Docker, k3s and openrc; the software it runs goes inside, as containers or processes.

A row in the `environments` table holds what only this module reads: its name among the Owning Agent's Environments, its host label, its endpoints, the access list, and its expiry.

## Lifecycle

- **Create.** Only an Agent can own Environments; an Environment cannot own one.
  An agent holds at most `environments.maxPerAgent` of them (default 5), each name once.
  The Agent is named `<owning agent> · <name>`, which keeps it unique among the owner's agents.
  If the row cannot be written, the Agent is deleted again.
- **Start.** A `start` command is delivered once, as a workspace command, that writes it as a [Startup Item](agent-processes.md#startup-items), an openrc user service, which then runs at every boot.
- **Sleep.** An Environment sleeps like any machine, after the install's idle time, and keeps its disk; there is no setting of its own.
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
  A shell gets what an openrc service gets of the machine's environment: the image's tool `PATH`, the gateway and CA settings, so `docker` and `k3s` pull as they do at boot, the image's `XDG_RUNTIME_DIR`, where `rc-service --user` finds the agent's own services, and `MISE_SYSTEM_DATA_DIR`, where a login shell's mise finds the image's tools.
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
Their URL, `<scheme>://{host}.<environments.domain>`, takes the install's `scheme` and `port` like the other public URLs, unless `urls.environments` sets it whole; the chart refuses a `urls.environments` whose host is not `{host}.<environments.domain>`, since the api-server reads the domain from the URL and the wildcard Ingress from `environments.domain`.

**One wildcard Ingress** for `*.<environments.domain>`, which the chart renders with the domain, sends every address to the api-server.
It carries one wildcard certificate, from `environments.ingress.tls.secretName`, which cert-manager can issue through an issuer with a DNS-01 solver named in `environments.ingress.annotations`; on OpenShift the Ingress becomes a wildcard Route, which the cluster allows once with `WildcardsAllowed`.
The local cluster serves `*.env.localhost` over plain HTTP.

**The gate.** The api-server reads the Environment and endpoint from the host name, before any other route, and relays HTTP and WebSocket to the Environment's runtime, which forwards to that endpoint's port on the Environment's own loopback and nowhere else.
The api-server names the declared ports on every request, so a port the Environment did not declare is refused, and so are the runtime's own ports.

- **Who may open it.** The owner keeps a list of people per agent, by email, which every Environment of that agent inherits; the owner and the agent's [Agent Editors](agent-editors.md) are always in, and an empty list means only them.
  The Owning Agent can narrow the list for one Environment (`access`), never widen it: an email off the owner's list is refused, and the agent cannot read the owner's list.
  A visitor matches by the email their identity provider verified, compared trimmed and lowercased; an account without one matches nobody's list.
- **The share host is the front door.** An address without a session gives the browser a sign-in secret in a cookie of its own and sends a page load to `/e/<address>` on the [share host](artifact-library.md#the-share-host--trust-boundary), with the secret's hash.
  The share host signs the visitor in with its own session and identity provider client, the ones a restricted artifact uses, so a visitor signs in once for both; one already signed in passes straight through, with no page and no click.
  It checks the owner and the effective list, and either shows a refusal naming the account the visitor is signed in with, whom to ask and a switch of account, or hands the address a code that works once, for that address and the browser holding the secret only, within a minute, so a code that leaks through a log, the history or a referrer opens nothing elsewhere.
  The address trades the code for a session cookie of its own: `__Host-platform-env` over HTTPS, scoped to that one origin, so no other Environment can set or read it.
- **One sign-in covers every endpoint.** In an Environment with several endpoints, the first address's code sends the browser on through each other endpoint, which gets a session the same way, bound to a secret of its own, and the last returns the visitor to the page they asked for.
  So an app whose pages call another of its endpoints, such as its own login server or API, finds a session there.
  Each step is a page that moves on by itself, not a redirect, so an Environment with many endpoints never reaches a browser's limit on redirects in a row.
- **The address checks again on every request**, by its session and the list as it stands, so a person taken off the list is refused at their next request.
  The session lasts only while the share host's session it came from does; signing out of an address ends both and the identity provider's session, and comes back to the share host's sign-in.
  Every address reserves `/.platform/` for the hand-off, the steps of a sign-in and sign-out, which never reach the app.
- **Only the visitor's own pages act in their name.** Every page under the platform's parent domain is the same site as an address, so the browser sends the session cookie with a request any of them makes, an artifact or another Environment's app included.
  The address refuses every request whose `Origin` is not one of its own Environment's endpoints — a script's call, a form post, a WebSocket — before it reaches the app; a link, a typed address, a frame and an image carry no origin and pass.
  A page whose `Referrer-Policy` is `no-referrer` sends its own form posts with the opaque origin `null`, which passes only when the browser also marks the request `Sec-Fetch-Site: same-origin`, a header no page can set.
  A CORS preflight from another endpoint of the same Environment carries no cookie, so the gate answers it itself, allowing the method and headers asked for with credentials; the call that follows is checked as any other, and its answer is the app's.
  A refusal of a call from another endpoint carries CORS headers for that endpoint, so its page reads the status instead of a network error.
- **Cookies and headers.** The relay never passes on the platform's own cookies (the session and the sign-in secret), passes on every cookie the app set itself, and never lets the app set the platform's.
  An `Authorization` header reaches the app unless it is a platform credential: a platform API key, a bearer token that names the platform's identity provider as its issuer or names none, or a bearer value that is not one token, so an app that signs its own users in gets their tokens.
  An app's cookie loses its `Domain` attribute, so it stays on the address that set it, and a WebSocket handshake passes no `Set-Cookie` at all.
  The original host and scheme go on as `X-Forwarded-Host` and `X-Forwarded-Proto`.
- **Wake.** A request to a sleeping Environment wakes it and waits until its runtime answers, not until the app does: a request that comes before the app listens gets the gate's "not answering" page, and the visitor tries again.
  Requests refresh its activity at most once a minute, and no open connection holds it awake, so a forgotten tab lets it sleep.
- **Every response is uncacheable**, and the security log records each new session and each refusal.

## An install inside an Environment

An agent can install the platform itself in an Environment, so a reviewer tries a change of the platform at the Environment's addresses.
The agent that installed it has no browser sign-in there and reaches it only through the [Environment Link](#the-environment-link), at `localhost` addresses on its own machine.
So such an install can answer on a second address set, the **backchannel** (`backchannel.*` in the chart values, off by default): `<domain>`, `keycloak.<domain>`, `share.<domain>` and `content.<domain>` with its own scheme and port, `http://localhost:4444` by default, beside its public addresses.
Only whoever reaches the Environment's own ports can open it: the Owning Agent, through a forward over the link; the gate never sends a visitor there.
Its host names differ from the public ones, which the chart and the api-server both check.

- **The chart** routes the four backchannel hosts too, and the realm's UI and share clients also allow their redirect URIs and web origins.
- **Keycloak** takes its address from each request instead of one fixed address, so a token names the address its sign-in started on; a code exchanged at the internal address still names that one.
  A refresh token is checked against the address of the request that uses it, so a server-side refresh would have to send the matching `X-Forwarded-Host`.
  Whatever routes to Keycloak must pass the browser's host and scheme.
- **The api-server** serves each request on the set its host name names, and on the public one for any other host.
  It accepts a token from either set's Keycloak address, and tells the UI the issuer of the set it was loaded from.
  Each set has its own share host app: its own sign-in callback, a session store and cookie of its own, so a share session from one set is never read on the other, and its own content host framed by its own share host.
  The Environments front door is on the public share host alone.
  Links the platform writes into messages and tool results stay on the public addresses.

`mise run cluster:install -- --environment <name>` installs or upgrades the platform in an Environment from a checkout, the same way every time (the `cluster-ops` skill has the steps).
The cluster tasks then act on the Environment's k3s instead of their own host's: the node over the link, the API through a tunnel the tasks open and reuse.
An Environment holds one install, so it is always the default install: a `--name` or `DAM_INSTALL`, and a worktree's branch, never name it (the skill's [Where and which](../../.agents/skills/cluster-ops/SKILL.md#where-and-which) has the name rule and the per-target table).
The public URLs are the Environment's `app`, `keycloak`, `share` and `content` endpoints, all on one port; the install stops, naming what to create, when one is missing.
It runs no mesh, which the Environment's kernel cannot.
Every Agent is a machine on a VM runner, so the install needs the Environment's guest to open `/dev/kvm`.
Nothing in the create asks for nesting: the Environment's machine nests through the install's `controller.agent.harnessTemplateDefaults.nestedVirtualization` and `virtualization.runner.nestedVirtualization`, both on by default, on a node whose KVM allows it.
An install that turns either off gives its Environments no `/dev/kvm`.
An Environment without it refuses the install and names that.
Each image whose source the registry already has is pulled by the Environment itself, and only a changed one is built by the agent and streamed in over the link.
Beside the chart it installs two pieces the gate needs:

- **A host-name bridge** on the endpoints' port: the gate relays every endpoint to that one loopback port with `Host: 127.0.0.1:<port>`, while the cluster's ingress routes by host name, so the bridge restores the host from `X-Forwarded-Host` and names the public scheme and port.
- **Trusted forwarded headers** on the ingress's app entrypoint, which only the Environment's loopback reaches, so Keycloak learns the browser uses HTTPS and sets its cookies `Secure`.

`--backchannel` turns the backchannel on, and `mise run cluster:open -- --environment <name> --port <port>` forwards its port (4444 unless `--backchannel-port` moved it) over the link to the agent's machine.

A second install of the same checkout changes nothing: an image the node already holds is not sent again, only a deployment whose image changed is restarted, and an agent image is staged again only when the node's copy changed.
The [end-to-end suite](e2e.md#running-it) runs against such an install on its backchannel: `e2e:loop -- --environment <name>` installs the lane's values there, then runs the suite over the link.

## Surfaces

**The Owning Agent** uses five platform MCP tools — `create_environment`, `list_environments`, `update_environment`, `wake_environment`, `delete_environment` — offered only to an Agent that is not an Environment, while its owner has the feature on, and `platform-env` in the image, which lists them and opens the [Environment Link](#the-environment-link).
They act on the calling Agent's Environments alone, found by name.

**The owner** lists an agent's Environments, extends or deletes one, and reads and sets the agent's list of people through the `environments` tRPC router, under the same scopes as the agent's own management.
In the app, an agent's page has an **Environments** section, behind the feature: the list of people who may open its Environments, at most 50, edited once it has loaded, and a row per Environment with each endpoint's link, whether it runs, its expiry, how many of the list may open it, and the owner's controls to extend and delete it.
The section is in the page's section navigation only once the agent has an Environment, since the agent creates them and an empty one teaches nothing, and it stays at its own address with its empty text, so a stale link still works.
While the agent has none, the Manage card of its General section links to the section, because the list of people can be set before the first Environment exists and is the list that first Environment inherits.
What an Environment runs, its Startup Items and their output, is not shown there yet.
The sidebar lists an agent's Environments under it, once it is expanded and only once it has one: a row each, with whether it runs, that opens the Environments section, and a link per endpoint that opens the app in a new tab.
The owner creates none there; the agent does.
Every Environments surface refreshes when one is created or deleted elsewhere, since an Environment is created as an Agent and its owner's agent hint refetches the list that decides whether they show; the hint sent at its create can arrive before its row is written, and the status hints that follow catch up.

The security log records each create and delete, naming the Owning Agent or the owner, each change to an agent's list of people, each new session with the person's email, and each refusal.
