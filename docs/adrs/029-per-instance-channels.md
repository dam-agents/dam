# ADR-029: Per-instance messenger channels

**Date:** 2026-04-23
**Status:** Accepted
**Owner:** @pilartomas

## Context

ADR-016 established that messenger integrations live inside the API Server and follow a pluggable "channel" abstraction, treating all channels uniformly. In practice, messengers split along a platform-vs-instance axis that has real consequences for secrets, identity, and authorization:

- **Platform channel** (Slack, ADR-018). One app serves the whole install. The operator configures it once via Helm values (`slackBotToken`, `slackAppToken`). Per-instance configuration is routing metadata — which Slack channel ID this instance listens to. Identity linking ties Slack users to Keycloak subs at the workspace level (ADR-018).
- **Per-instance channel** (Telegram). Each instance owns its own bot, created by the instance operator via `@BotFather`. The platform never learns the bot token at install time; it arrives through the UI when an instance operator wires up their channel.

Adding Telegram made it clear that treating per-instance as a distinct category — with its own patterns for secrets, authorization, and lifecycle — is clearer than stretching Slack's platform model over it. This ADR codifies the per-instance pattern so future channels (WhatsApp Business, Discord, SMS providers where the tenant brings credentials) can follow it mechanically.

## Decision

### Secrets — k8s Secrets, one per (instance, channel type)

Bot tokens live in namespaced k8s Secrets:

- Name: `platform-channel-<type>-<instanceId>` (e.g. `platform-channel-telegram-acme-bot`)
- Labels: `platform.ai/type=channel-secret`, `platform.ai/instance=<id>`, `platform.ai/channel-type=<type>`
- Data key: `botToken`

Consequences of this shape:

- Postgres keeps only the fact that a channel is enabled (a row in `channels` with empty `config` for Telegram). **No bot secret at rest in the database.**
- Tokens never round-trip to the UI — the input is write-only with a "Change token" affordance for updates.
- The `TelegramConnected` event carries only `instanceId`. The channel manager reads the token from the secret store at worker-start time. Tokens do not traverse the in-memory event bus.
- Lifecycle is trivial: connect = create, disconnect = delete. Instance deletion cascades via label selector in the existing k8s cleanup saga.
- RBAC already grants the api-server Secret verbs in the agent namespace (unchanged since ADR-006); no chart changes needed.

Rejected:
- **Plaintext in Postgres.** Leaks via DB dump, backup, or incidental logging.
- **App-level encryption of `channels.config`.** Still needs key management without gaining the benefits of a native primitive.
- **One Secret per instance carrying all channel tokens.** Forces read-modify-write on every connect/disconnect plus bookkeeping for "delete the Secret once the last channel is gone." Per-(instance, type) gives clean lifecycle at negligible object-count cost.
- **External secret manager (Vault, ESM).** Out of scope; the `ChannelSecretStore` interface is small enough that a Vault-backed implementation can slot in later.

### Authorization — per-thread, not per-user

Slack's model is: the bot is a member of a channel, anyone in the channel can mention it, and a per-instance allowed-users list gates who is actually served. That works because bot identity and workspace membership are platform-level facts.

Telegram has no workspace. The bot joins arbitrary DMs and groups. So we shift the authorization boundary from the user to the conversation:

- A thread (DM or group) is inactive until someone runs `/login`, which launches a Keycloak OAuth flow. On successful callback, the conversation is marked authorized in `telegram_authorized_threads`.
- `/logout` revokes authorization.
- In groups, only admins may `/login` or `/logout` (verified via `getChatMember`).
- Unauthorized threads: the bot prompts for `/login` in DMs; stays silent in groups (to avoid spamming every chat the bot happens to be in).

"Authorize the conversation, not the user." It matches the Telegram primitive and avoids maintaining a workspace-wide identity mapping for a per-instance bot.

### Thread lifetime — one ACP session per authorized thread

Each authorized thread holds a single ACP session, persisted in the `sessions` table keyed by instance + thread. This keeps conversation context coherent across turns without replaying history on every message. See ADR-025 for the analogous Slack pattern; the idea is identical, the authorization model is not.

### Public API — tokens are write-only

The public `TelegramChannel` type exposes only `{ type }`. The `connectTelegram` mutation takes the token as input; all read paths (`instances.list`, `instances.get`, `Instance.channels`) omit it. Stored vs. view types are separated: `StoredTelegramChannel` (internal, carries the token) vs. `TelegramChannel` (public, metadata only).

## Differences from Slack at a glance

| Aspect | Slack (platform, ADR-018) | Telegram (per-instance) |
|---|---|---|
| Who installs the bot | Platform operator, once | Instance owner, via @BotFather |
| Token provenance | Helm values → env var | UI input → k8s Secret |
| Identity model | Slack user ↔ Keycloak sub (workspace-wide) | Thread authorization (no user mapping) |
| Access control | Per-instance allowed-users list | `/login` per conversation |
| Scope | One bot serves all instances | One bot per instance |

## Consequences

- Adding a new per-instance channel is mechanical: a new worker, routing wiring, and reuse of `ChannelSecretStore` + the thread-authorization pattern.
- Operators running purely with Slack are unaffected.
- The channels table in Postgres stores only metadata. This closes the "prototype gap" called out in ADR-016 (channel config in ConfigMaps).
- Per-tenant key management falls on k8s Secret handling — no new crypto code, no new key rotation procedure beyond what Platform already inherits.
- Tokens are not printable anywhere in the platform UI once saved; operators changing a token must paste a new one.

## Related

- **ADR-005** (credential gateway): does not apply — messenger tokens are platform-consumed (by the API Server), not agent-outbound.
- **ADR-016** (messenger integration): this ADR refines the per-instance case. The "channel config lives in a ConfigMap" note in ADR-016 is superseded — channels are now in Postgres and their secrets in k8s Secrets.
- **ADR-018** (Slack integration): the platform-channel counterpart.
- **ADR-025** (persistent ACP session per Slack thread): same "session per thread" idea with Slack's authorization model instead.
