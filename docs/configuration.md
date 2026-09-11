# Configuration

How to configure [Platform](../README.md) after installation: secrets for the credential gateway, Slack integration, and the development-mode toggle. For *what* Platform is and how it's built, see the [architecture docs](architecture.md).

## Secrets

Agents and other connections require API tokens to communicate with their providers. These secrets are managed through the Platform UI, at whatever address your install serves.

Each agent's paired gateway injects credentials on the wire — agents never see the secret bytes. The api-server holds them in the install's database, keyed by the owner's `sub`, and the node running an agent materializes only that agent's set, readable only by that gateway's account.

1. **Add a secret** — open the Connections panel in the UI. For Anthropic, you can use `claude setup-token` as the token value. For other connections, use the OAuth flow for the provider or a Generic secret.
2. **Connect an OAuth app** — for GitHub, GitHub Enterprise, and other named providers, click Connect and complete the browser flow. The api-server stores the resulting tokens; the refresh-token loop re-mints them before expiry.

## Skills

Three kinds of source show up in the Skills panel:

- no badge — repos you added yourself; deletable.
- **Platform** (blue) — seeded by the cluster admin; read-only.
- **Agent** (purple) — declared by this instance's agent template; read-only.

Seed Platform sources with `SKILL_SOURCES_SEED` in the node's configuration, or per-template sources in the template's own file — same shape either way:

```yaml
skills:
  skillSources:
    - name: "Anthropic Skills"
      gitUrl: "https://github.com/anthropics/skills"

agentTemplates:
  claude-code:
    skillSources:
      - name: "Anthropic Skills"
        gitUrl: "https://github.com/anthropics/skills"
```

Users can also author skills in the Files panel and publish them upstream as pull requests via the Publish button on standalone skill rows. Publishing requires a connected GitHub account.

## Object storage

Artifact content is stored in an S3-compatible object store. The chart bundles a single-node SeaweedFS by default, so a fresh install needs no setup. For production, point the nodes at your own store instead, in their configuration:

```sh
OBJECT_STORAGE_ENDPOINT=https://s3.eu-central-1.amazonaws.com
OBJECT_STORAGE_REGION=eu-central-1
OBJECT_STORAGE_BUCKET=my-platform-artifacts
# Leave both empty to use the AWS SDK default provider chain (e.g. IRSA).
OBJECT_STORAGE_ACCESS_KEY_ID=…
OBJECT_STORAGE_SECRET_ACCESS_KEY=…
# path-style is for SeaweedFS/self-hosted; AWS wants virtual-hosted
OBJECT_STORAGE_FORCE_PATH_STYLE=false
```

Disable the bundled store with `seaweedfs.enabled=false` in the chart when you
supply your own.

The api-server creates the bucket at startup if it is missing (grant CreateBucket, or pre-create the bucket to run with tighter credentials). Disabling both the bundled store and the endpoint disables artifact storage — uploads fail with a clear error.

Artifact bytes move directly: agents upload to the store through their gateway using short-lived links the platform mints, so the size cap is policy, not a transport limit. Set `OBJECT_STORAGE_PUBLIC_ENDPOINT` to a browser-reachable address (for external stores usually the same as `endpoint`) to have downloads redirect to the store as well; leave it empty and the api-server serves downloads itself — note it buffers each download in memory, so if you raise `MAX_ARTIFACT_BYTES` well past the default, set `publicEndpoint` too (and size the bundled store's volume to match).

## Knowledge base sharing

Sharing a knowledge base as a read-only MCP endpoint needs object storage configured (above) — snapshot bytes live in the store. Caps are set in the node's configuration, each `KB_SHARE_` plus the name below:

- `perFileMaxBytes` (default 2 MiB) — largest single text file a publish includes.
- `totalMaxBytes` (default 200 MiB) — total text content per published snapshot.
- `maxFiles` (default 5000) — most files a publish includes before it fails loudly.
- `grepDeadlineMs` (default 2000) — hard deadline for one consumer grep or glob call; the worker thread running the consumer-supplied regex/glob is terminated when it lapses.
- `maxConnectionsPerOwner` (default 20) — most shared-knowledge-base connections one account may hold.

Consumers read shared snapshots over the **harness route** (`/api/agents/:id/kb`), not the egress gateway. The same serving app is also reachable on the share host as a by-link endpoint for external MCP clients.

## Experiments

A `running` Experiment whose script sends no trace event for `EXPERIMENT_INACTIVITY_SECONDS` (api-server env var, default 900) is reaped to `failed`, releasing the driver agent's hibernation pin. The SDK heartbeats every ~60 s from a background thread, so quiet-but-alive stages (long spawns, local compute) don't trip it — a reap means the script process is gone.

## Slack Integration

Platform runs a single Slack app (Socket Mode) for the entire installation. A Slack channel binds to at most one instance globally; the binding routes every mention in that channel.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `files:write`, `groups:read`, `im:write`, `reactions:write`, `reactions:read`, `commands`, `users:read`, `users:read.email`. (`channels:read`, `groups:read`, and `im:write` power agent-initiated posts to other bot-member channels and direct messages; without them agents can still post to their bound channel. The `users:read` pair lets an agent resolve the user ids it sees in a conversation to names and profiles — the email field needs `users:read.email`. `reactions:read` lets an agent look up who reacted to a message and with what emoji. All three are optional: an install without `users:read` never registers the lookup tool at all, rather than exposing one that would always fail, and `reactions:read` gates the reaction-lookup tool the same way; an install with `users:read` but not `users:read.email` still resolves people, just without their email.) [`etc/slack/app-manifest.yaml`](../etc/slack/app-manifest.yaml) carries the full scope and event-subscription set — create the app from it to get everything, including the scopes that ambient mode needs.
2. Add slash command `/platform` pointing to your app.
3. Generate an app-level token (`xapp-...`) with `connections:write` scope. Put both in every node's configuration (see [Node configuration](#node-configuration)):

   ```sh
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```

4. In the Platform UI, click the Slack icon on any instance and connect it to a channel (or `dam channel slack connect <agent> --channel-id <C0…> [--ambient]`).

The binding is the authorization: anyone in the channel drives the instance under the instance's own credentials, no login required; Slack channel membership is the only per-person gate, and the owner's Terms-of-Use acceptance covers every turn.

A mention in a channel no instance is bound to gets an ephemeral rejection.

## Telegram Integration

Platform runs a single Telegram bot for the entire installation. A Telegram chat (DM or group) binds to at most one instance; the binding routes every message in that chat.

1. Create one bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Put the token (and, recommended, the bot's handle) in every node's configuration: `TELEGRAM_BOT_TOKEN=<token>` and `TELEGRAM_BOT_USERNAME=<handle>`.
3. Connect a chat: add the bot to a chat (or message it directly) and send `/platform bind` (or just `/start`). In groups, only chat admins can start the flow. Complete the browser login and pick the instance.
4. The bot confirms in the chat.

**Access model** — connecting a chat is the owner's consent; anyone in the chat can drive the instance, no account needed. Every turn runs under the instance's own credentials, and `/platform unbind` in the chat disconnects it (the owner can also disconnect it from the web UI). Messages in unconnected group chats are ignored.

## Node configuration

Everything above that a node reads lives in one file, `/etc/dam/env`, and a
node reads it once at boot. `vm:install` writes what it can derive — where the
shared services are, who this node is — and appends an operator file after it,
so anything set there wins. Copy [`etc/node.env.example`](../etc/node.env.example)
to `etc/node.env`, or point `DAM_NODE_ENV_FILE` at your own. On a
cluster-provisioned node the same content arrives through cloud-init instead.

Whatever is left unset stays at its built-in default, and a feature whose
credential is missing stays off rather than failing later: no messenger tokens
means no Slack or Telegram worker, no telemetry backend means the spend
surfaces read closed.

## Development mode

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run //packages/ui:run             # start UI dev server
```

Platform detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization.
