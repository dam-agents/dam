# Channels

Last verified: 2026-07-20

## Overview

A **channel** is a messenger surface (Slack, Telegram) that lets users drive an Agent from outside the UI. Channels are pluggable adapters that live inside the api-server process — no separate Deployment, no sidecar in the agent pod. Each adapter (the *worker*) owns its inbound socket, its outbound API, and its thread-to-session bookkeeping; a `ChannelManager` service composes the workers and reacts to lifecycle events on the in-process event bus.

Channel bindings are **1:1 with Agent**: a Slack channel may be bound to at most one Agent globally, and Agent delete or Slack disconnect releases the binding.

Channels split along a structural axis that has real consequences for secrets and identity:

- **Platform channel** — one app serves the whole install. The operator configures it once via Helm values; per-Agent config is just *which conversation this Agent listens to*. Both messengers are platform channels today. On Slack, identity linking ties messenger users to Keycloak subs at the workspace level.
- Telegram's variant: there is no workspace to anchor per-user identity in, so a Telegram *conversation* binds to exactly one Agent — the owner consents by completing an in-chat `/login` plus a web agent-picker flow — and anyone in the bound chat may drive that Agent.

### Access modes

A Slack binding carries an **access mode**, chosen at bind time (UI form or CLI flag) and fixed for the binding's lifetime — switching modes is a deliberate disconnect + reconnect, never a side effect of re-connecting; a connect that requests a different mode for an existing binding is rejected with that instruction. The binding record stores only the non-default mode; an absent mode means person-scoped.

- **Person-scoped** (default) — the identity-linked model described throughout this page: Slack users link their platform identity, the per-Agent allowed-users gate admits repliers, owner turns relay to the main pod, and foreign-replier turns fork under the replier's own credentials.
- **Shared** — the binding itself is the authorization: anyone the messenger admits to the channel drives the Agent. No identity link, no allow-list. Every shared turn relays single-track to the main agent pod under the Agent's own credentials; the **binding owner's** Terms-of-Use acceptance gates each turn (the terms bind the party whose credentials run it, not the member who typed); the security log records each allow with basis *place* and the sender's Slack user id; and the prompt text is speaker-labelled with the sender's Slack mention, so a multi-speaker session stays attributable inside the conversation itself.

Telegram is structurally shared-only — with no workspace to anchor per-user identity, consent attaches to the conversation and everyone in the bound chat drives the Agent. Shared Slack bindings deliberately mirror those semantics.

#### Ambient mode (shared bindings only)

A shared Slack binding can additionally run in **ambient mode**: the agent reads along with the whole channel conversation and decides for itself when to chime in — answering a question it can answer, picking up a task someone described, flagging a clear mistake — staying silent otherwise. Mentions keep the addressed-turn treatment unchanged; ambient only adds a second, quieter inbound path.

Unlike the access mode, ambient is **mutable and off by default**: the binding owner opts a channel in at connect time (UI form, CLI flag) or flips it later — a same-mode re-connect updates it in place, and an in-chat ambient command (allowed for the binder or the agent's owner, the unbind authorization) is the in-channel dial. Because ambient changes what the channel's members should expect — the agent now reads every message, waking from hibernation to do so — every flip is recorded in the security log and announced channel-visibly; the announcement is best-effort (a Slack outage can drop it, logged), the audit record is not.

Ambient turns are deliberately unobtrusive: no acknowledgment reaction, no wake notices, and failures are logged and evented but never posted — nobody summoned the agent. The agent declines by replying with a fixed token that the worker swallows instead of posting; the token contract is re-stated on every ambient prompt, since ambient and mention-driven turns interleave in the same sessions. Each relayed message is still security-logged as a place-basis allow (marked as ambient-triggered), and the binding owner's Terms-of-Use acceptance gates ambient turns like any shared turn — silently.

Inbound traffic and outbound traffic take different paths. Inbound is push from the messenger into the api-server worker, which routes the message to the agent pod over ACP. Outbound is pull initiated by the agent: the harness calls a tool on the api-server's per-Agent MCP endpoint, and the api-server delegates to the right worker.

Two cross-cutting concerns are owned elsewhere and only summarized here:

- **Foreign replier fork** (person-scoped Slack bindings). Slack's two-tier access (channel membership + per-Agent allowed users) admits multiple authorized users into one thread. Owner replies relay to the main pod; replies from any other authorized user fork into a per-turn paired pod set — a fork agent Job and a fork gateway Pod, each with its own NetworkPolicy — whose gateway mounts the replier's K8s credential Secrets. The pair spec, the foreign-credential selection, and the shared-PVC mechanics are covered on [security-and-credentials](security-and-credentials.md). Channels just see "main pod or fork pod" at the relay step.
- **Thread-session binding.** A thread maps to one resumable session, so the agent gets real conversational continuity. The binding is the session's own `_meta.platform.threadTs`, resolved by listing sessions over ACP and matching — there is no server-side session store.

## Topology

Both adapters share the same shape inside the api-server — a worker that owns the messenger socket, the `ChannelManager` that supervises lifecycle, the ACP relay for inbound, and the per-Agent MCP endpoint for outbound. The interesting parts are where the two diverge: Slack hangs off a workspace-wide identity link table; Telegram hangs off the `telegram_conversations` binding table (conversation → Agent). Both messengers' tokens come from Helm values.

### Slack — platform channel

```mermaid
flowchart LR
  SU[Slack user]
  SAPI[Slack API]

  subgraph api-server[api-server process]
    CM[ChannelManager]
    SW[SlackWorker]
    IL[IdentityLinkService]
    MCP[per-agent MCP endpoint]
    REL[ACP relay]
  end

  subgraph DB[Postgres]
    LNK[(identity_links<br/>provider=slack)]
  end

  POD[agent pod<br/>main + forks]

  SU <--> SAPI
  SAPI <-- Socket Mode --> SW
  CM --> SW
  SW --> IL
  IL --> LNK
  SW -- ACP session/list + relay frames --> REL
  REL <--> POD
  POD -- send_channel_message --> MCP
  MCP --> CM
```

Bot and App-Level Tokens come from Helm values and live in api-server env — no per-Agent Secret. Resolving the channel's binding yields the Agent, the binding owner, and the access mode. On person-scoped bindings the workspace-wide identity-link table backs the `/platform login` flow, and the relay path branches between the main pod and a per-turn fork pod by replier identity ([security-and-credentials](security-and-credentials.md)); on shared bindings the relay is single-track to the main pod.

### Telegram — platform channel

```mermaid
flowchart LR
  TU[Telegram user]
  TAPI[Telegram API]

  subgraph api-server[api-server process]
    CM[ChannelManager]
    TW[TelegramWorker<br/>one platform bot]
    MCP[per-agent MCP endpoint]
    REL[ACP relay]
  end

  subgraph DB[Postgres]
    BND[(telegram_conversations<br/>chat → agent)]
  end

  POD[agent pod]

  TU <--> TAPI
  TAPI <-- long polling --> TW
  CM --> TW
  TW -- resolve binding --> BND
  TW -- ACP session/list + relay frames --> REL
  REL <--> POD
  POD -- send_channel_message --> MCP
  MCP --> CM
```

The bot token comes from Helm values and lives in api-server env, like the Slack tokens. A conversation binds to exactly one Agent in `telegram_conversations` (the conversation id is the primary key); the single bot polls for the whole install and resolves each inbound message to its chat's binding. The relay path is single-track — the main pod handles every turn, no foreign-replier fork (there is no per-user identity to fork under).

## Adapters

Both workers implement the same internal contract — `start`, `stop`, `stopAll`, `listConversations`, `postMessage` — keyed by agent id. The differences are transport, identity model, and where the bot token comes from.

### Slack — platform channel

- **Transport.** Socket Mode, one workspace-level WebSocket from the api-server to Slack. The api-server has no inbound network access requirement; events arrive over the socket the api-server itself opened. Slack caps Socket Mode at ten concurrent connections per app, which is the install-level scale ceiling for Slack.
- **Token provenance.** App-Level Token (`xapp-…`) and Bot Token come from Helm values, set at install time. Not stored per-Agent.
- **Identity linking** (person-scoped bindings). A `/platform login` slash command starts a Keycloak OAuth flow; on callback the api-server stores `slack_user_id ↔ keycloak_sub`. All subsequent interactions require a linked identity; unlinked users get an ephemeral prompt to log in. The link table is the source of truth for "who is this Slack user in Platform terms." Shared bindings never consult it.
- **In-chat binding** (creates a shared binding). Beyond the platform UI and CLI, a channel can be bound from inside Slack, mirroring Telegram: anyone runs `/platform bind`, authenticates through the same Keycloak OAuth flow, and picks one of *their own* Agents on a web picker — the binding lends that Agent, under its own credentials, to the whole channel. An in-chat ambient command reports and flips the binding's ambient mode under the same binder-or-owner authorization as unbind. There is no admin gate (unlike Telegram's group-admin check); the ownership check on the picked Agent is the control, and the bind also links the initiator's identity so they can later release it. A bind never overrides an existing one — an already-bound channel is refused until it is unbound. `/platform unbind` releases the binding and is allowed for the binder or the Agent's owner; the owner can also disconnect from the platform UI/CLI as an escape hatch.
- **Access control.** Decided by the binding's access mode. Person-scoped: two tiers — channel membership is the coarse gate (users must be in the Slack channel to see the bot's interactions); per-Agent allowed users is the fine gate (each Agent optionally declares the subs that may *trigger* work; non-listed users in the channel still see responses but cannot drive a session). Combined with foreign-replier forking, this lets a thread have multiple authorized drivers whose actions land under their own identities. Shared: channel membership is the only per-person gate, and Slack owns it — the platform never resolves who is typing; binding the channel is the consent that lends the Agent to the channel.
- **Agent resolution.** A channel binds to at most one Agent globally, so a mention resolves to exactly one Agent by channel id; a mention in an unbound channel is refused with an ephemeral.
- **Ambient message intake.** For ambient mode the gateway also subscribes to plain channel messages and pre-filters them: bot posts (including the agent's own replies, preventing loops), message edits and joins, DMs, and bot-mentions (those arrive on the mention path) never reach the worker. The worker then relays only when the channel's binding is shared with ambient on; every other message drops silently — the sender didn't address the agent, so there is nothing to explain. This requires the Slack app to subscribe to channel-message events with the matching history scopes ([`deploy/slack-app-manifest.yaml`](../../deploy/slack-app-manifest.yaml)).

### Telegram — platform channel

- **Transport.** Long-poll `getUpdates` — one client for the install, started unconditionally at boot so `/login` works in chats that have no binding yet.
- **Token provenance.** The operator creates one bot via `@BotFather` and sets the token in Helm values; it reaches the api-server as env. No per-Agent Secrets, no token at rest in Postgres.
- **Identity model — there is none per user.** Telegram has no workspace to anchor a user-to-Keycloak link against, so consent attaches to the *conversation*: someone sends `/login` (in groups, only chat admins, verified via `getChatMember`; `/start` counts as login intent too, so deep links and the Start button work), the bot replies with a Keycloak OAuth link, and after authenticating the user lands on the UI's agent picker listing *their own* Agents. The binding records conversation id, agent id, and the owner's sub as `authorized_by`, and the bot posts a confirmation in the chat. The chat's members never authenticate. `/logout` unbinds, and the owner can also disconnect a bound chat from the web UI — the bot posts a farewell note in the chat before the binding is released. Unbound groups stay silent so the bot does not spam every chat it has been added to.
- **Lifecycle.** There is none per Agent — bindings are rows, not runtime state. Agent deletion clears the Agent's rows via the channel-cleanup saga.

Slack keeps per-Agent worker registration via `SlackConnected` / `SlackDisconnected` / `AgentDeleted` events on the rxjs bus; bootstrap on api-server startup starts the Telegram client and walks the Slack channel bindings.

## Inbound — channel message to ACP session

```mermaid
sequenceDiagram
  autonumber
  participant U as Channel user
  participant M as Messenger API
  participant W as Worker<br/>(Slack/Telegram)
  participant API as api-server relay
  participant POD as agent pod<br/>(main or fork)

  U->>M: post message in thread
  M-->>W: event delivery<br/>(Socket Mode / long-poll)
  W->>W: identity / auth checks
  W->>API: ACP session/list
  API-->>W: sessions + _meta.platform<br/>(wakes pod if hibernated)
  alt a session's _meta.platform.threadTs matches
    W->>API: ACP session/prompt<br/>(resume matched sessionId)
  else first message in thread
    W->>API: ACP session/new<br/>(_meta.platform: type, threadTs)
    API-->>W: sessionId
    W->>API: ACP session/prompt<br/>(thread history as context)
  end
  API->>POD: relay frames<br/>(wake if hibernated)
  POD-->>API: assistant turn
  API-->>W: assistant response
  W->>M: post reply in thread
  M-->>U: reply visible
```

A few observations the diagram glosses over:

- **Identity gates differ per adapter and mode.** On person-scoped Slack bindings the worker runs the linked-identity check, the per-Agent allowed-users check, and the owner-vs-foreign decision (the latter selects whether the relay targets the main pod or a fork Job). On shared Slack bindings the gates collapse to the binding check plus the binding owner's Terms-of-Use acceptance — no sender identity is resolved. Telegram behaves like shared Slack: it resolves the chat's binding and checks the binding owner's terms acceptance; there is no foreign fork because there is no per-user identity to fork under.
- **Wake is implicit.** The relay step is the same `ACP relay → wake-if-hibernated → forward` path used by the UI. Channels do not call lifecycle endpoints directly; routing an ACP frame is what wakes the pod ([agent-lifecycle](agent-lifecycle.md), §Wake).
- **Wake failures are surfaced in human terms.** A cold start announces itself to the Slack sender (requester-only notice); a wake that misses its budget while the pods are still progressing posts a still-starting note and waits one more window before answering, so a healthy-but-slow start never loses the turn. A hard failure (pod crash, bad image, reconcile error) replies with copy derived from the classified wake-failure cause — never the internal error string, and never raw controller messages. Telegram replies with the same copy on wake failures (no early notice, no extended wait).
- **Resume vs. new is decided by the ACP session list.** The original Slack design treated every message as a new session; today the binding lives on the session itself: the worker lists sessions over ACP and resumes the one whose `_meta.platform.threadTs` matches. If `unstable_resumeSession` fails (PVC lost, session expired), the worker falls back to creating a new session with thread history injected from the messenger API — degrading to pre-feature behavior for that thread, no regression.
- **`threadKey` is adapter-specific.** Slack uses `thread_ts`; Telegram uses the conversation id (chat id + optional forum topic). It is carried on the session as `_meta.platform.threadTs` and matched in-process against the ACP session list; there is no longer a DB uniqueness guard, so two concurrent first messages in a brand-new thread can mint two sessions for the same key.
- **Ambient routing: one session per thread, plus one per channel.** On an ambient binding, a thread reply relays into that thread's own session — the same key a mention there would resume. Top-level channel messages instead share a single rolling **ambient session** per channel (a synthetic key in the same thread-key slot, un-collidable with real thread keys), so the agent genuinely follows the channel rather than starting cold per message. Top-level ambient traffic is serialized per channel and coalesced — messages arriving while a turn is in flight flush as one multi-message prompt — so a busy channel never races concurrent prompts into the shared session. When the agent chimes in, the reply is threaded under the triggering message; the follow-up conversation in that thread then runs as an ordinary thread session, with thread-history injection carrying the context across.
- **Turn relays emit `ChannelTurnRelayed`.** Both Slack and Telegram workers emit a `ChannelTurnRelayed` event on the in-process bus after the ACP turn finishes, carrying `channel`, `agentId`, `actorSub` (the relaying user's Keycloak `sub` on person-scoped Slack turns; `null` on shared Slack and Telegram turns, where no platform identity is resolved — those turns instead carry `externalActorId`, the messenger-native id of the sender), and `outcome` (`"success" | "failure"`). Failed turns additionally carry a low-cardinality failure reason (the classified wake-failure cause, a fork failure, or a generic relay error), which the audit trail and usage records project — so failed turns are diagnosable from the log store after the fact. The usage subsystem consumes this for activity tracking ([usage-tracking](usage-tracking.md)); the forks subsystem also subscribes to drive paired-pod teardown on Slack.

## Outbound — agent to channel

Outbound is initiated by the agent process. The harness calls a tool on the api-server's per-Agent MCP endpoint, the endpoint authenticates the call, and the channel manager routes the message back through the right worker.

```mermaid
sequenceDiagram
  autonumber
  participant H as Harness<br/>(in agent pod)
  participant MCP as api-server<br/>MCP endpoint
  participant K as K8s API
  participant CM as ChannelManager
  participant W as Worker
  participant M as Messenger API

  H->>MCP: POST /api/agents/{id}/mcp<br/>tool: send_channel_message
  MCP->>K: resolve source pod IP → agent label
  K-->>MCP: agent + owner
  MCP->>MCP: verify caller IP belongs to {id};<br/>caller.owner == agent.owner
  alt verification fails
    MCP-->>H: 401 / 404
  else verified
    MCP->>CM: postMessage(agentId, channel, text, chatId?)
    CM->>W: postMessage(agentId, text, chatId?)
    W->>M: post (top-level or threaded)
    M-->>W: ack / error
    W-->>CM: { ok } | { error }
    CM-->>MCP: result
    MCP-->>H: tool result
  end
```

What the agent sees:

- **Two tools** are registered on the per-Agent MCP server: `describe_channel` returns the authorized chats (DMs / threads / groups) for a given channel type, and `send_channel_message` posts text to a chat. The agent picks the channel by argument (`slack` or `telegram`); `chatId` addresses a specific chat. Omitting `chatId` resolves per channel type: Telegram posts to the worker's last-active thread (error if none); Slack posts to the single channel bound to the Agent, and rejects a `chatId` that isn't that bound channel.
- **Tools are always registered.** Calls are rejected at invocation time when no channel is connected for the Agent — no dynamic tool list, no per-session toggle.
- **Bidirectional channel.** If a channel is connected to an Agent, every session on that Agent can post — interactive sessions and scheduled sessions alike. There is no per-session outbound flag.

Why the dedicated MCP endpoint:

- **Network isolation.** The MCP port is the only api-server port the agent's NetworkPolicy admits. The agent cannot reach the admin API (tRPC, OAuth, agent management) — only this one endpoint.
- **Auth without an admin login.** Caller identity is derived from the source pod IP, mapped to a `platform.ai/agent` label via the api-server's `podIpResolver` cache. The agent does not present a Bearer token — a compromised harness can't claim to be a different Agent because the kernel-verified source IP is the source of truth. Owner match (caller.owner == agent.owner) is the second check.
- **Direct path to channel infra.** The MCP endpoint dispatches into the same `ChannelManager.postMessage` that workers use internally — no agent-runtime round-trip, no second relay hop.

### Threading model

Outbound posts are **fire-and-forget at the thread level**. The agent posts a top-level message; the worker does not store any `threadTs → sessionId` mapping for proactive posts. If a user replies to the resulting thread, the inbound path treats it as a new mention — a fresh session. Continuity from the originating session does not carry over. This is the deliberate trade-off: keep outbound simple and stateless at the cost of session bridging on Slack-side replies.



The two messengers diverge slightly on what a top-level post means:

- **Slack:** the worker posts to the channel id (or the last-active channel for the Agent) with no `thread_ts`, producing a new top-level message. A reply from a Slack user is a new mention.
- **Telegram:** there is no thread primitive in DMs and only weak threading in groups. The worker posts to the chat id; if the agent's prompt was triggered by a previous message in the same chat, that chat is still the conversation.

## Per-Agent vs. platform channel

Both messengers are platform channels: install-wide credentials from Helm and a conversation→Agent binding table, differing mainly in where the binding is gestured — Slack from the UI/CLI (person-scoped or shared) or an in-chat `/platform bind` (shared), Telegram from an in-chat `/login` plus the web agent picker. Future channels (WhatsApp Business, Discord, SMS) follow the same pattern — the Telegram flow is the template for messengers without a workspace identity to anchor per-user links against.

## Persistence touchpoints

Channels touch two stores; the substrate details live on [persistence](persistence.md):

- **Identity-link and binding tables (Postgres).** `identity_links` keyed on `(provider, external_user_id)` mapping to `keycloak_sub` — Slack's person-scoped bindings populate it today, but the `provider` column makes the table reusable for any future workspace channel. Slack channel bindings live in the channel rows owned by the agents module; each binding carries its access mode (absent = person-scoped) and, on shared bindings, the ambient flag (absent = off). `telegram_conversations` records the conversation→Agent binding for Telegram (plus the binding owner's sub). Different shapes by design — Slack has a workspace, Telegram does not. Both messengers' tokens live in api-server env from Helm values; there are no channel Secrets in k8s.

Channels do **not** participate in the Agent ConfigMap spec/status split. An earlier design kept channel config in the Agent ConfigMap; that was superseded: channel routing metadata lives in Postgres, secrets in k8s Secrets, Agent ConfigMaps stay channel-free.
