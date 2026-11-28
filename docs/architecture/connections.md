# Connections

Last verified: 2026-11-28

## Overview

A Connection is everything an agent needs to talk to one external integration — credentials, hosts to reach, config files to author, MCP entries to expose, skills to install.
Connection Templates are code-level catalog entries that ship defaults; granting a Connection to an Agent materializes its Contributions into the right destinations.

The Connections context owns Connection Templates, Connections, and grants.
It computes each Agent's Contribution set and routes every Contribution to the rail that delivers it.

Contributions on the runtime-channel rail are carried by a separate subsystem — the transactional outbox, the delivery worker, and the agent-side drivers and event handlers are documented in [runtime delivery](runtime-delivery.md).
This page stops at the rail boundary.

A grant of one Connection produces Contributions of several kinds.
They don't all travel the same rail:

```mermaid
flowchart LR
  grant[Connection grant on Agent A]
  hostRail[egress-allow / egress-inject / egress-sign Contributions]
  rtRail[env / file / mcp-entry / skill-ref Contributions]
  envoy[egress_rules then Envoy ext_authz]
  channel[runtime channel]

  grant --> hostRail
  grant --> rtRail
  hostRail -->|sync rows| envoy
  rtRail -->|outbox row| channel
```

There are two rails.
`egress-allow`, `egress-inject` and `egress-sign` Contributions sync into Postgres `egress_rules` and are read live by Envoy; `egress-inject` additionally carries a credential the gateway injects on the wire, and `egress-sign` names a host whose requests the gateway re-signs with the Connection's keys (mechanics in [credential gateway](credential-gateway.md)).
Everything else — `env` (formerly a controller-render/pod-roll rail; moving it onto the runtime channel means a grant change no longer rolls the agent), `file`, `mcp-entry`, `skill-ref` — travels the runtime channel, and how it gets there is [runtime delivery](runtime-delivery.md).
The rest of this page is what a Connection is and what a grant produces.

## Concepts

### Connection Template

A code-level catalog entry.
Premade templates (GitHub, Anthropic, Spotify, Figma MCP, …) ship with full defaults — auth flow, hosts, scopes, recommended contributions.
Custom templates (Custom MCP, Custom OAuth, Custom Header) ship the *shape* but leave the integration's identity for the user to fill in.

Three display-axis attributes drive UI grouping.
`category` and `isCustom` place a template in a section; an optional **family** (`github`, `github-enterprise`, `kubernetes`, `modal`, `mcp-server`, `custom-header`) groups templates the catalog shows as one connect page with several methods, and is what a [starter kit](starter-kits.md) names when it accepts any method of a provider.
Families are declared on the templates themselves and carried on the template view, so nothing else keeps a copy of the membership.

| `category` | `isCustom` | Where the user encounters it                                                            |
| ---------- | ---------- | --------------------------------------------------------------------------------------- |
| `app`      | `false`    | Apps section: GitHub, Spotify, Anthropic, OpenAI, Google services, GitHub Enterprise, … |
| `mcp`      | `false`    | MCP servers section: Figma MCP, … (as added)                                            |
| `mcp`      | `true`     | Custom Connection → "Add MCP server"                                                    |
| `other`    | `true`     | Custom Connection → "Add OAuth credential" / "Add Header credential"                    |

Templates are registered in code; adding a new integration is one entry.
Schemas validate user input; the template's `build()` function projects inputs into the concrete `auth` + `contributions[]` of the Connection record.

Beyond the auth credential, a template may declare optional **config inputs** that the user fills at connect time; each filled input projects into an additional `env` contribution, validated against the input's spec.
They can change later without re-entering the credential, unless one also decides an egress host.

#### Internal-only templates

Some templates (Spotify, YouTube, Google services, and the custom client-credentials shape) are hidden from regular users client-side, affecting only what's offered (wherever the catalog is browsed), not Connections already created.
Testers reveal the full catalog by enabling the *advanced connections* per-user internal feature flag — see [features](features.md).
The install's own [DAM Connection](connection-presets.md#platform-preset-this-install-itself) is offered only to a person whose own flag says so, because only the platform mints its credential: with the flag off the catalog hides it and no grant of it is accepted, while a Connection already made keeps working.
The GitHub App templates are offered to everyone, grouped with the other GitHub auth methods.

### Connection

A uniform shape — every Connection looks the same regardless of category or auth mode: identity and owner, the source Template, a user-visible name, the recorded inputs (the user's own, kept for re-render, plus any platform-derived facts the Connection is identified or labelled by), the auth credential state, and the projected contributions.

The `auth` field carries credential-acquisition state in one of six modes: **OAuth** (a client identity, references to the stored refresh and access tokens, and granted scopes), **client credentials** (machine-to-machine OAuth — a client identity plus references to the stored client secret and tokens minted from it), **GitHub App** (a GitHub App identity plus a reference to the stored private key and the installation tokens minted from it — client credentials' JWT-signed counterpart), **header** (a reference to the stored secret plus the header name and value format to inject), **SigV4** (an HMAC key pair for S3-compatible storage — references to the stored access key ID, secret access key and the credentials file the gateway signs with, plus the signing region), or **none**.
Token references point at the per-Connection K8s Secret — never inline secret material.
Exact field shapes live in the [Connections contract types](../../packages/api-server-api/src/modules/connections/).

An Agent may hold several **provider Connections**, at most one per **provider alias**: the alias names the provider in every qualified model name, so a second Connection behind one alias is refused.
A session picks its model per turn, and the provider follows from the name.
Creation grants the one it names, else one provider Connection the owner holds that the harness runs on: the provider of the owner's [default for new agents](profiles.md#the-default-for-new-agents) when the agent starts on it, else the first in the harness's provider order, taken from the providers its [starter kit](starter-kits.md) lists when the owner holds one of them ([agent-lifecycle](agent-lifecycle.md#create)).
The agent's Providers section lists every provider Connection the owner holds with a grant toggle; picking a profile grants the provider it runs on ([profiles](profiles.md)).
A provider Connection, and its Template, carry their alias and the harnesses of the catalog that run on it in every listing, so a caller tells providers apart without knowing template ids; the listing also marks one **preferred**: the one a create that names no provider grants — the provider of the owner's [default for new agents](profiles.md#the-default-for-new-agents) where they hold one, else the first in the provider order of the harness a plain create boots on (the default's, else the install's), and none while the owner holds no active provider that harness runs on — unless a starter kit lists other providers.
A provider Connection's env lands in a per-provider layer the Model Router reads; granting or revoking one recycles the [Harness Leases](sessions.md#session-inside-the-machine).

Credentials carry their own lifecycle.
A stored one can be **updated in place** — the injected value, the client secret, the GitHub App private key, or the storage key pair, whichever the auth mode holds.
The minting modes validate by using the secret, at create and on every rotation alike, so an unusable one fails before anything is persisted; a storage key pair is proven the same way, by a request to its endpoint, and a rotation the endpoint refuses leaves the working pair in place.
A model provider's key is proven where the provider offers a check.
A key that passes names its account where the provider tells that key: an Anthropic OAuth token the email and organization of its profile, an Anthropic or OpenAI API key the organization its provider answers with, an IBM LiteLLM or Bob key the user it belongs to, and a Bedrock key its AWS account.
The account is extra: a lookup that fails leaves the key passed, with no account.
A provider that cannot say leaves the key unverified; the CurveBender deployment's key, which the user holds no copy of, leaves it unchecked.
The result of that check and its time are kept on the Connection, since a key that worked when it was saved can be revoked or expire later; the owner can recheck the keys of all their provider Connections at once, server-side, which Settings › Providers also does each time it opens, and a key the provider refuses then reads as refused until it is replaced.
A rotation rewrites the credential and its SDS — or, for a key pair, the credentials file the gateway signs with — onto the same per-Connection Secret; nothing else moves — identity, contributions and every agent grant are preserved, and since the live value is read gateway-side, no Agent-spec patch or pod roll is needed.
A static key pair has no expiry and no horizon: it reads active until it is rotated or the Connection is removed.
A credential can also be typed on a **secret-entry page** of the web app instead of into the client that asked for it.
The client hands the api-server every input except the secret and gets a single-use link that expires after ten minutes; the request lives in Redis and the link carries only a random id.
The page and its submit run as the signed-in user and refuse a request another user made, so a link sent to someone else collects nothing.
Before the user types, the page shows what the save will do — the template, the name, every host the secret is sent to with its header, the env vars agents see, and for a rotation the agents it is granted to — computed by the same builder the create runs, and it warns when a host is not one the template presets.
The submit then runs the ordinary create or rotation, with its validation; a refused secret leaves the link usable until it expires.
A header template may also name a **credential check**, which the GitHub personal access token templates do: the token is tried on the user endpoint of its GitHub host before it is stored, on create and on rotation alike.
The check passes, naming the account, the expiry and, for a classic token, the scopes; fails, with GitHub's reason (bad credentials, or SSO authorization an organization requires); or stays unchecked when GitHub gives no answer about the token.
The Kubernetes template names one too: the api-server posts a SelfSubjectReview to the cluster's API server with the token, trusting the Connection's stored CA when it has one and the public roots otherwise, as the gateway does.
Any authenticated identity may create a SelfSubjectReview, so the check needs no permission beyond the token.
It passes naming the user the token acts as (`system:serviceaccount:<namespace>:<name>`) and the expiry from the token's `exp` claim; fails on a 401, saying the token expired when its claim is past, on a certificate the CA or the public roots do not trust, and on any other TLS error; and stays unchecked on a cluster older than Kubernetes 1.28, another answer, or no answer.
A **GitHub App** connection is checked with the installation token it mints, which the save already requires, so a saved one passes naming its bot, the account the app is installed on and the repositories the token reaches.
A key rotation, a scope change and a check on demand mint again; a refusal fails, naming the input at fault.
The page holds a token that does not pass, and one that passes but expires within a day, so the user can fix it on the same link, and saves it on a confirmed "save anyway": the user is warned, never blocked.
Saved through any path, the token keeps the result and its time on the Connection, which every listing carries, so a token saved after a failed check does not read like a healthy one; the owner can check one stored credential again, which replaces the result, and a provider key is checked again with its provider check.
The client polls a status that says only pending, saved (with the Connection's id), cancelled or expired: no reader gets the secret back.
The page covers the static and minting kinds; OAuth needs no secret here.
An Agent can ask for the same page through its platform MCP server (the `connection_secret` tool), as its owner: the link is the owner's, and the page names the Agent that asked.
An Agent's request is narrower than the CLI's, because the Agent, not the person, chose its inputs: a new Connection must send the secret only to the hosts its template presets without config inputs, so a custom template, an S3 endpoint or a host of the Agent's choosing is refused, and a rotation names only a Connection granted to that Agent.
The Connection the page creates is granted to the Agent that asked, and the status that Agent polls says whether the grant took; it reads only its own requests.
OAuth stays a person's step: an Agent does not start a sign-in.
An **OAuth** credential is re-acquired, not pasted: re-running login and consent on the same Connection lands fresh tokens on the same Secret and asks for the template's current scopes, so a scope list that grew since create takes effect then.
A credential that stops working reads as **expired**: the refresh loop persists a marker when the token endpoint *rejects* it rather than merely failing to answer, and a marked Connection stops being retried until a new credential clears it.
A rejected *operator-supplied* client secret stays retryable, so a centrally-fixed one revives without per-connection action.
A Connection on the operator's app — one that brought no client secret of its own — reads that app's client ID from the install each time it signs in or renews, as it reads the secret, so a rotated app takes effect on every such Connection at once; one with its own secret keeps the ID it was made with.
A failure that is not a rejection parks nothing and instead defers the next attempt on a widening backoff held on the Connection itself, so a renewal that keeps failing is not re-attempted every sweep; any successful credential write clears both records.
Credential writers — refresh, rotation, re-consent, and the re-point of a shared knowledge base onto a fresh link — serialize per Connection across replicas with an in-lock re-read that stands down if the state already advanced; grant fan-out serializes per Agent.
Past its token horizon a Connection also reads expired, since a healthy one is renewed well ahead of it; a provider issuing non-expiring tokens has no horizon and stays active.

A **client-credentials** connection resolves the token endpoint from the authorization server's published OAuth metadata at create time and mints its first access token synchronously.
The issuer URL is optional — when omitted it is discovered from the API host's published OAuth metadata.
The same background loop that refreshes OAuth tokens re-mints it before expiry using the stored client secret.
One per-Connection Secret holds the client secret, the current access token, and the SDS files baked from it; only the minted access token is ever injected on the wire.

A **GitHub App** installation and a **GitHub sign-in** made through a GitHub App are *parents*: they hold the credential and no Agent holds them; an Agent holds a Connection made from one, with its own scope, or full access named on purpose, and its own token ([github-connections](github-connections.md)).

A grant can name a **Grant Credential**: a credential the platform made for one or more grants of the Connection, used in place of the Connection's own.
A grant that names none uses the Connection's own credential, as every grant did before.
A credential's value is in a Secret of its own, and its row says which Connection it serves and what it holds; a credential that a grant still names cannot be removed, so a grant never goes back to the wider credential by a deletion.
The agent's gateway sends exactly the credential its grant names ([credential gateway](credential-gateway.md#envoy-credential-injection)), and a change of it re-renders that agent's gateway, as a change of its grants does.
Nothing makes a credential yet.

**Tool access** is what one Agent may do with the tools of one MCP Connection, and it lives on the grant, so a change for one Agent never reaches another.
Each tool has one **tool rule**: allow sends the call, ask holds it as a tool-call approval (below), and block refuses it at once.
A tool access holds one rule for the **read tools**, one for every other tool, and the tools whose own rule differs from their group's.
A tool takes its own rule, else its group's, and a tool the stored list does not name is not a read tool: a tool the server adds later follows the rule for every other tool until a new read of the list names it as reading.
A grant that stores no tool access follows its Connection's **tool mode**, which stands for one: read only allows the read tools and blocks the rest, needs approval allows the read tools and asks for the rest, and allow all allows every tool.
A Connection that stores no mode takes its Template's default, else allow all; the Slack Account's default is read only.
Every MCP Connection with a Secret has tool access, because the gateway injects its credential, so it reads the requests to the Connection's MCP host and sends their body to the gate.
A custom MCP server with no auth has no Secret, so its requests pass the gateway unread and it allows every tool, with no access to set ([mcp-connections](mcp-connections.md#tool-list)).
The api-server reads the server's **tool list** itself, as an MCP client with the Connection's own credential, because the gate never sees the server's answer and the Agent cannot be trusted to report it.
It reads the list when the credential first works, at create or at the OAuth callback, again when a new credential replaces the old one, and when the owner refreshes it, and stores each tool's name and whether it reads: the server's `readOnlyHint`.
A list that fails keeps the tools read before and stores why, for the owner to see, and never fails the create or the update.
A Template may declare its own read list, as the Slack Account does, and that list wins over the server's hints, in the stored list and at the gate.

With the `mcp-tool-approval` [internal feature](features.md) on for the owner, a new grant starts safe: each group takes the stricter rule of the safe start and of the Connection's mode, so a grant never starts looser than the mode the owner chose.
The safe start is read only where the Template's default is read only, as on the Slack Account, else the read tools allowed and every other tool asking.
Every path that grants does so, and a grant that is new when the grants are written always gets it, also one that another request revoked just before; a grant that already exists keeps its own when the Agent's grants are written again.
A sub-agent that takes its connections from its Driver, all of them or a list, starts each new grant of such a Connection with what the Driver's grant stores, or with nothing where it stores nothing, so both follow the mode; a Connection the Driver does not hold gets the safe start ([invocations](invocations.md)).
A later change of the Driver's access reaches the same grant of every child that keeps in step with it, and of their children; a child given a list keeps what it copied.
Otherwise a new grant never copies another Agent's access.
With the feature off a new grant stores nothing and follows the mode, unless it copies its Driver's.
Only the Connection's owner sets a grant's tool access, an Editor of the Agent never on the owner's Connections, and only with the feature on, for an Agent that holds the Connection, on a Connection the gateway reads.
An own rule equal to its group's is dropped, the number of own rules and the length of a tool name are capped, and every change the owner makes is written to the security log.
The owner sets it in the tool access dialog for one Agent, opened from the Agent's Connections or from the Agents listed inside the Connection's row on the Connections page, riskiest first; the dialog sets each group, opens a group to give a tool its own rule, and shows and refreshes the stored tool list.
Each place sums the access up in a few words, such as read only or asks before writing, and marks an Agent that writes without asking: its rule for every other tool is allow, so a tool the server adds later runs at once, or a tool that is not a read tool has its own allow; the CLI uses the same rule, and the Connections page row counts those Agents.
An own rule on a tool the stored list does not name counts everywhere: in the summary, in the marks, and in the dialog, where it shows under the other tools as not in the tool list.
The connect forms ask nothing about access while the feature is on.
With the feature off the owner sees and sets only the Connection's mode, and only where the Template's default is read only: the Slack Account keeps its two-way choice between read only and "Can post as me", which is allow all, and other MCP Connections show no mode.
Setting the mode clears the tool access of every grant of the Connection, sub-agents' included, so every Agent that holds it follows the mode again: it is the one change that reaches every Agent.
An Agent granted later starts from the mode, or, with the feature on, from the stricter of the mode and the safe start.
Every client reads a grant's access only while the owner has the feature, so with it off the screens and the CLI show what they showed before it.
Turning the feature off therefore keeps every grant's stored access, and the gate still holds the Agent to it, but nothing shows it; setting the Connection's mode clears it.
The flag decides which screens read and write the access, never what the gate reads.
A Connection still in needs approval when the feature is turned off keeps its mark and its dialog, so the owner can switch it to another mode it offers, but not back.
The CLI sets one Agent's access with `scope --agent`, the mode with `--mode`, and lists the tools with each one's rule with `dam connection tools` ([cli](cli.md)).

The gateway refuses a blocked tool, and holds a tool that asks as a tool-call approval (below) that shows the call where network approvals show; approve once sends it, and deny once or no answer within the hold window refuses it.
Only an owner with the feature on sets a rule or a mode that asks.
A Template may render its own tool calls on that approval: the Slack Account shows a call that posts, replies in a thread, schedules a message or saves a draft as the message itself, with who wants to post where and as whom, the text under the owner's name with Slack's formatting, and buttons that name the action, such as Post and Don't post.
The text is built from Slack's marks and never set as HTML, so a message that carries HTML shows it as text.
A link whose label is not its own address shows the real address after it, whole when it is short, else its host, so a label cannot hide where the link goes.
A mention or a channel reference shows the Slack id it notifies, never the label written beside it.
Marks nest at most six deep; deeper text shows as typed.
Every other tool, or a call whose arguments are not in the shape the renderer expects, shows the tool name and its arguments, with Allow once and Deny.
The approval counts down to its refusal, and says what happened once it is answered.
When the gateway files such a Slack approval, the platform looks up the name of the channel or person with the Connection's own credential, waits for it at most two seconds, and keeps it on the approval; the approval shows the Slack id when that lookup fails.
The Agent still sees every tool the server lists, and a refused call is answered with an error it can read.
The limit is the **tool access step** of the ext_authz gate ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)), after the spend and web search steps and before any rule is read, so no egress rule lets a refused call through.
On the Connection's MCP host, named by the request's TLS server name or its Host header, the gate reads the request's whole body, which that host's chain sends with every check ([credential-gateway](credential-gateway.md#envoy-credential-injection)), and refuses a call of a blocked tool, also inside a batch, with JSON keys read in any letter case.
It reads the Agent's grants with their tool access from the database once on every request, with no cache, so a change holds from the Agent's next request; writing a grant's tool access does not advance the Agent's generation, so nothing is rendered again for it ([persistence](persistence.md)).
A stored tool access that cannot be read blocks every tool.
A request that names a Connection the Agent holds gets that grant's rules; any other request to that host gets, for each tool, the strictest rule among the Agent's grants there, because the gateway adds a credential to a request that names none where nothing contests the host.
Block is the strictest, then ask: block refuses at once and never asks a person for an approval they did not expect.
The refusal is a JSON-RPC error on a successful reply that says the gateway refused the call, names the tool and the Connection, says the tool is blocked for this Agent and who can change that, so the Agent can explain it and its session goes on.
A POST whose body did not come with the check, was read in part, or is not one strict JSON document with unique keys is refused rather than passed, and so is a method an MCP client does not need.
While any grant of the Agent that the gateway reads has a rule other than allow, a TLS request that can carry a body and comes without a server name is refused with a retry: its gateway has not restarted onto the check yet, and there the Host header alone could hide the MCP host.
That window opens only when a Connection whose Secret was written before every MCP Connection with a Secret asked for the body first limits tool calls, because its Secret is written again then and starts to ask for it.
Whoever acts with the owner's rights can make a change, an Agent that holds the owner's [DAM Connection](connection-presets.md#platform-preset-this-install-itself) included.
The Slack Account Connections made before tool access existed kept full access, so none was narrowed silently; when the mode moved out of the OAuth auth, one with full access became allow all and one without it read only.

A **tool-call approval** answers one call of a tool that asks, so a request that carries one such call is held, and a batch that contains one is refused with a request to send the calls one by one; a batch whose tool calls are all allowed passes.
Calls with the same Connection, tool and arguments share one approval, whatever their request id or key order: a retry joins the waiting approval, and a call with other arguments files its own.
It takes approve once and deny once only, so nothing is remembered and no rule is written.
Deny once, and the end of the hold window, answer the call with an error the Agent can read, and its session goes on.
The arguments are kept only while the approval waits, and are dropped when it resolves or expires.
An unattended channel turn refuses the call at once and files the approval, as for a network request ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)); a sub-agent with network access of its own cannot ask, so its call is refused without one.
MCP clients give up on a tool call after a timeout of their own, so where a harness lets the platform set it, each Connection's MCP entry carries the hold window as that timeout.
A client that gives up first leaves the approval pending: the owner still sees it, and the same call sent again within the window joins it and waits only until the window ends.
An approve once given while no call waits is used up by the next identical call within the window, which is made at once; the call after it files a new approval.
Each approve once makes exactly one call, even when identical calls race for it, and a held call that lost the race gets an error that says so.
After the window, a retry files a new approval and the old one can no longer be approved.

A Connection that acts as a person rather than as the Agent records **whose account** it acts as, so the product can name that person wherever the Connection is listed.
The platform asks the provider with the Connection's own credential (Slack, GitHub and the Google services today) when the credential first works: at the OAuth callback, at create for a token, and again on every re-consent or rotation, since a new credential may belong to someone else.
The answer is a platform-derived fact on the Connection, never a user input.
A label the provider chooses, such as an account or a repository name, is cleaned of control characters and capped in length before it is stored or shown, so a hostile host cannot spoof the terminal or the page with it.
A lookup that fails costs nothing but the label.
Connections made before this existed are labelled by a background sweep that tries each one once per api-server process, so a credential the provider refuses is not retried in a loop.

Connect and disconnect raise domain events, recorded as [Activity Events](usage-tracking.md).
A connect fires wherever the Connection actually reaches its connected state — at creation for the modes that complete synchronously, and at the authorization callback for OAuth, which is the only mode that cannot finish in one step.
Emitting at both points would double-count OAuth; emitting only at the callback leaves every other mode invisible.
A connection abandoned before that state raises neither event, so removals cannot outnumber connects.
A parent raises neither event either: the Connections made from it do, when made and when removed, also when they go with their parent.
A new header key raises `ConnectionCredentialChanged`, so the [spend module](spend-limits.md#prices) reads that Connection's prices again.
The event names the provider, not just the grant, because the Connection record is destroyed on disconnect and a grant identifier alone would die with it.

### Contribution

A typed unit a Connection emits when granted to an Agent — a discriminated union over `kind`.
The kinds today:

- **`env`** — an environment variable the harness merges in at spawn.
  For credential-derived env the value is a placeholder (the real secret is injected gateway-side); for user-typed and non-credential config env it is the literal value.
- **`egress-allow`** — permission to reach a host (optionally path-scoped, optionally port-scoped for endpoints not on 443).
- **`egress-inject`** — an allowed host plus a credential the gateway injects on the wire, as a header or a query parameter.
  May additionally name a non-443 upstream port, opt the host's chain into streaming-upgrade tunneling (WebSocket/SPDY — `kubectl exec`/`port-forward`), carry the upstream's private CA for gateway-side TLS validation, and declare path prefix rewrites the gateway applies on the way upstream (mechanics in [credential gateway](credential-gateway.md)).
- **`egress-sign`** — an allowed host whose requests the gateway re-signs with the Connection's key pair instead of injecting a header, carrying the signing region and service.
  May name a non-443 upstream port, and is path-scoped to the bucket when the Connection is limited to one (mechanics in [credential gateway](credential-gateway.md#request-signing)).
- **`file`** — a config file to author, with a format and a merge mode (see [Built-in contribution impls](runtime-delivery.md#built-in-contribution-impls)).
- **`mcp-entry`** — an MCP server to expose to the harness.
- **`skill-ref`** — a skill source to install at a pinned version.

Kinds are added by extending the union and gating on agent capabilities (see [Versioning](runtime-delivery.md#versioning)).
Exact per-kind fields live in the [Connections contract types](../../packages/api-server-api/src/modules/connections/).

### Addressing a Connection

A user may hold several Connections to one service — two Slack workspaces, two GitHub identities, two tenants of one MCP server — and, where the platform can tell them apart, grant more than one of them to the same Agent.
They reach the same host, so the host alone does not say which account a request acts as.

Each Connection therefore has an **address**, in two carriers.
One is a per-Connection path prefix on the real host, `/__platform_conn/<connection id>/`: the gateway picks the credential from that path and strips it before the request leaves, so the upstream sees the address it published.
The other is the Connection's **token placeholder**, `platform:conn:<connection id>`: every credential placeholder a Connection hands the Agent — a `GH_TOKEN` env, the token in gh's hosts file, a placeholder in an MCP entry's headers — is that value rather than an inert constant, and a client that sends it where the real token goes has named the Connection, whatever URL it asked for.
A client that refuses a key without its vendor's prefix is handed the address behind that prefix (`as-platform:conn:<id>`), and the gateway reads it there too; a credential inside a config file, like a kubeconfig token, is addressed the same way.
The gateway reads it out of the claimed header (bare, behind a scheme such as `token` or `Bearer`, or as the password of a Basic pair) or the claimed query parameter, and overwrites it with the real credential as before.
A storage Connection is addressed through its access key ID: the placeholder stands where the key ID goes in a SigV4 credential, the gateway reads it from there and re-signs the request with the real pair, and the path prefix does not apply, since the gateway signs the upstream path ([credential gateway](credential-gateway.md#request-signing)).
The host stays the real one either way, so egress rules, approval prompts and logs keep describing the real destination.

The address is a property of the Agent's grant, not of the stored Connection: contributions are recorded against the real address and the inert placeholder, and the runtime state an Agent is given carries the prefixed URLs and the per-Connection placeholder.
So a Connection's address is stable whether or not a second Connection to that service exists, and adding one never re-addresses the first.
The platform prefixes the `mcp-entry` URLs of each Connection — the addresses it writes on the Agent's behalf.
The Agent sees those entries under the names the user gave the Connections, so two workspaces read as two named servers.
The two names the platform injects under are reserved: an entry name is the prefix on every tool it carries, so a Connection wearing one would displace the platform's own entry and inherit the approval a relayed turn gives that surface ([channel turns](channel-turns.md)).
Naming refuses them and delivery drops them, and the Agents already holding one were re-delivered once, so rows predating the rule are covered too.

Naming a Connection is only *required* where two of them genuinely collide: the same header on the same host over paths that overlap.
Connections that scope themselves to different parts of one service — one per Google Workspace service on `www.googleapis.com` — are not rivals, and each keeps being injected on its own paths without any address.
Where the scopes do overlap, an unaddressed request fails closed at the gateway, because the alternative, serving it from whichever credential sorted first, is the silent wrong-account failure this addressing exists to end — unless the Agent requires naming (below), where it carries no credential of the Agent's at all.

An Agent can make naming *required* for every one of its Connections; a new one does unless its create or starter kit says otherwise.
The Agent's spec says so, and agent settings change it later.
Its gateway then injects a Connection's credential only into a request that names it, and sends any other request upstream with the credential it already carries, rather than replacing it.
That holds on contested scopes too: a request naming none of two rival Connections goes upstream unchanged, so a public download from a host where the Agent holds two accounts answers as it does to anyone, and nothing is ambiguous, since no credential is chosen.
It serves an agent whose tools — Docker containers, nested agents, a browser its user drives — call the same hosts with their own credentials or none: their requests name none of the agent's Connections, so the gateway leaves them alone.
Off serves the opposite: tools that need a credential added to a request naming no Connection.
Platform-written values already carry an address, so the agent's own clients are unaffected.
A Connection with no credential of the agent's own is reachable only through its path prefix.
Only such an agent offers the [browser panel](browser-panel.md), whose user browses through the agent's gateway.

**Default accounts.** Where an Agent holds several Connections of one group — a GitHub host is one group, and an Agent's storage Connections form another (below) — the account active on delivery is the grant the user marked **preferred** on the Agent, chosen from the Agent's connections panel, at most one per group, or, absent a choice, the earliest grant, which is the account the Agent already acted as.
Every state push re-asserts that default, so a switch the Agent made itself lasts until the next push.
Ordering, the default and the account names are one rule for every kind of Connection with a default account; a kind says only how its Connections group and how a name is spelled for its tool, and the connections panel offers every group's choice in one callout.
How two GitHub accounts share one host, through gh's own hosts file, is on [github-connections](github-connections.md#several-github-accounts).

Two limits follow.
First, an address exists only where the platform writes one or the Agent can send one.
A Connection reached with no credential of the Agent's own — a Custom Header credential that sets no env — has no address the Agent can use, and two Connections whose placeholders would land in one env — two accounts of one Google service, both writing the same variable — can deliver only one of them, so in either case two such Connections that collide can never both work: every request where their paths overlap is refused, or, on an Agent requiring naming, sent with neither credential.
GitHub is the collision the platform resolves, through gh's hosts file.
The Connections context therefore refuses to grant an Agent a Connection that collides with one it holds unless both are addressed — when a grant is added and when an Agent is created with its first grants — and the connection pickers say which granted Connection is in the way.
An Agent that already holds such a pair can still change its other grants, and is shown a warning naming the pair until one is revoked.
Two GitHub accounts, two Slack workspaces or two tenants of one MCP server are addressed, so they stay grantable together; so are two storage Connections on one endpoint, whose gateway signs only the requests that name each and never contests the host.

Second, a path address only holds while the Agent keeps using it: an upstream that answers with an absolute URL of its own, stripped of the prefix, sends the Agent back unaddressed.
A token placeholder is not lost this way, since it rides in the credential rather than the URL.
That is an accepted limit rather than a guarded one — the reply is a refusal the Agent can read, not a request served as the wrong account.

## Connection presets

What each shipped template gives an Agent, and what a grant of it materializes, is on [connection presets](connection-presets.md).
How a custom MCP server's OAuth client, scopes and resource identifier are found is on [MCP connections](mcp-connections.md).

## Built-in contributions

Not every contribution comes from a grant: the runtime state builder also merges **built-ins** the platform itself contributes.
Every agent gets the platform MCP entry and its display name as the `PLATFORM_AGENT_NAME` env var, which a rename refreshes at the next harness spawn without a restart; a sandbox holding at least one shared-knowledge-base grant additionally gets the aggregate `knowledge-bases` MCP entry pointing at the in-cluster harness route (`/api/agents/:id/kb`, alongside the platform MCP entry), appearing and disappearing with its first and last such grant.

## Contribution fan-out

The api-server's contribution-fanout layer routes each Contribution kind to the rail that delivers it.
Different rails because the kinds have genuinely different delivery semantics:

| Kind            | Rail                                                                                        | Delivery semantics                             | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`           | Runtime channel `applyState` (state slice)                                                  | Sub-second push; applied at next harness spawn | Written to a JSON file the harness spawn path merges into the process env. Two sources feed it — user-typed env (the Environment editor) and connection-derived env — user env ordered first so it wins on name collision (first-occurrence-wins). A change recycles the harness at an idle turn boundary; only a variable-set change may force one mid-turn, never past a kept [Harness Task](agent-processes.md#reported-background-work) — value-only changes spare in-flight runs. No restart. |
| `egress-allow`  | Postgres `egress_rules` → Envoy `ext_authz`                                                 | Live read; no pod involvement                  | Joined per-grant; revoke sweeps rows, except a preset row the grant took over, which goes back to the preset; at startup the api-server marks such rows taken over before the mark existed, for an agent still on the trusted preset. Agent never sees these.                                                                                                                                                                                                                                      |
| `egress-inject` | Postgres `egress_rules` → Envoy `ext_authz`, plus a wire-injected credential at the gateway | Live read; no pod involvement                  | Same `egress_rules` row as `egress-allow`; the gateway also injects `headerName`/`valueFormat` on the wire (mechanics in [credential gateway](credential-gateway.md)). Agent never sees these.                                                                                                                                                                                                                                                                                                     |
| `egress-sign`   | Postgres `egress_rules` → Envoy `ext_authz`, plus a signing step at the gateway             | Live read; no pod involvement                  | Same `egress_rules` row as `egress-allow`, path-scoped to the bucket when one is set; the gateway re-signs requests naming the Connection with its key pair (mechanics in [credential gateway](credential-gateway.md#request-signing)). Agent never sees the keys.                                                                                                                                                                                                                                 |
| `file`          | Runtime channel `applyState` (state slice)                                                  | Sub-second push; idempotent reconciliation     | Per-format + per-mergeMode driver materializes.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mcp-entry`     | Runtime channel `applyState` (state slice)                                                  | Sub-second push; idempotent reconciliation     | Driver dispatches to harness-specific path.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `skill-ref`     | Runtime channel `applyState` (state slice)                                                  | Sub-second push; per-version installer         | Driver wraps existing skill-fetch helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The rail choice is a property of the kind, not of the Connection.
A single grant of GitHub Enterprise produces Contributions on both rails: `egress-allow` (egress_rules → Envoy live), and `env` + `file` (runtime channel push).
They flow independently.

## Persistence touchpoints

| Substrate                    | What lives there                                                                 | Notes                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres `connections`       | Connection records                                                               | The unified model's own table.                                                                                                                                              |
| Postgres `connection_grants` | Grants, each with its tool access                                                | The tool access step reads it on every request.                                                                                                                             |
| Postgres `egress_rules`      | `egress-allow`, `egress-inject` and `egress-sign` Contributions joined per grant | Existing table; same as today. All three kinds produce the same allow row; `egress-inject`'s credential and `egress-sign`'s signing step ride a separate gateway-side rail. |
| K8s Secret per Connection    | Auth credentials (refresh tokens, api-keys, HMAC key pairs)                      | Owner-label-scoped; mounted into the paired gateway pod, never into the machine. A parent's holds its credential; a Connection made from it holds only its own token.       |

## Invariants

- **Every Contribution kind has exactly one rail.** The api-server's fan-out determines which rail per kind; drivers, controller-render, and Envoy never overlap responsibilities on the same kind.
