# Configuration

How to configure [Platform](../README.md) after installation: secrets for the credential gateway, Slack integration, and the development-mode toggle. For *what* Platform is and how it's built, see the [architecture docs](architecture.md).

## Secrets

Agents and other connections require API tokens to communicate with their providers. These secrets are managed through the Platform UI at [platform.localhost:4444](http://platform.localhost:4444).

The Envoy sidecar in each agent pod injects credentials on the wire — agents never see the secret bytes. The api-server stores secrets as K8s Secrets labelled with the owner's `sub`; the controller mounts the matching set into the Envoy sidecar only.

1. **Add a secret** — open the Connections panel in the UI. For Anthropic, you can use `claude setup-token` as the token value. For other connections, use the OAuth flow for the provider or a Generic secret.
2. **Connect an OAuth app** — for GitHub, GitHub Enterprise, and other named providers, click Connect and complete the browser flow. The api-server stores the resulting tokens; the refresh-token loop re-mints them before expiry.

## Skills

Three kinds of source show up in the Skills panel:

- no badge — repos you added yourself; deletable.
- **Platform** (blue) — seeded by the cluster admin; read-only.
- **Agent** (purple) — declared by this instance's agent template; read-only.

Seed Platform sources via `skills.skillSources`, or per-template sources via `harnessTemplates.<name>.skillSources` — same shape either way:

```yaml
skills:
  skillSources:
    - name: "Anthropic Skills"
      gitUrl: "https://github.com/anthropics/skills"

harnessTemplates:
  claude-code:
    skillSources:
      - name: "Anthropic Skills"
        gitUrl: "https://github.com/anthropics/skills"
```

Users can also author skills in the Files panel and publish them upstream as pull requests via the Publish button on standalone skill rows. Publishing requires a connected GitHub account.

## Object storage

Artifact content is stored in an S3-compatible object store. The chart bundles a single-node SeaweedFS by default, so a fresh install needs no setup. For production, point the platform at your own store instead — same shape as the external-database config (`apiServer.db`): a set endpoint wins over the shared local instance.

```yaml
seaweedfs:
  enabled: false

apiServer:
  objectStorage:
    endpoint: "https://s3.eu-central-1.amazonaws.com"
    region: "eu-central-1"
    bucket: "my-platform-artifacts"
    # Leave both empty to use the AWS SDK default provider chain (e.g. IRSA).
    accessKeyId: "…"
    secretAccessKey: "…"
    forcePathStyle: false # path-style is for SeaweedFS/self-hosted; AWS wants virtual-hosted
```

The api-server creates the bucket at startup if it is missing (grant CreateBucket, or pre-create the bucket to run with tighter credentials). Disabling both the bundled store and the endpoint disables artifact storage — uploads fail with a clear error.

Artifact bytes move directly: agents upload to the store through their gateway using short-lived links the platform mints, so the size cap is policy, not a transport limit. Set `apiServer.objectStorage.publicEndpoint` to a browser-reachable address (for external stores usually the same as `endpoint`) to have downloads redirect to the store as well; leave it empty and the api-server serves downloads itself — note it buffers each download in memory, so if you raise `apiServer.maxArtifactBytes` well past the default, set `publicEndpoint` too (and size the bundled store's volume to match).

## Knowledge base sharing

Sharing a knowledge base as a read-only MCP endpoint needs object storage configured (above) — snapshot bytes live in the store. Caps are set under `apiServer.kbShares`:

- `perFileMaxBytes` (default 2 MiB) — largest single text file a publish includes.
- `totalMaxBytes` (default 200 MiB) — total text content per published snapshot.
- `maxFiles` (default 5000) — most files a publish includes before it fails loudly.
- `grepDeadlineMs` (default 2000) — hard deadline for one consumer grep or glob call; the worker thread running the consumer-supplied regex/glob is terminated when it lapses.
- `maxConnectionsPerOwner` (default 20) — most shared-knowledge-base connections one account may hold.

Consumers read shared snapshots over the **in-cluster harness route** (`/api/agents/:id/kb`), not the egress gateway, so the cluster's own service DNS must resolve (the standard CoreDNS setup — no extra configuration). The same serving app is also reachable on the share host as a by-link endpoint for external MCP clients.

## Experiments

A `running` Experiment whose script sends no trace event for `EXPERIMENT_INACTIVITY_SECONDS` (api-server env var, default 900) is reaped to `failed`, releasing the driver agent's hibernation pin. The SDK heartbeats every ~60 s from a background thread, so quiet-but-alive stages (long spawns, local compute) don't trip it — a reap means the script process is gone.

## Slack Integration

Platform runs a single Slack app (Socket Mode) for the entire installation. A Slack channel binds to at most one instance globally; the binding routes every mention in that channel.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `files:write`, `groups:read`, `im:write`, `reactions:write`, `reactions:read`, `commands`, `users:read`, `users:read.email`. (`channels:read`, `groups:read`, and `im:write` power agent-initiated posts to other bot-member channels and direct messages; without them agents can still post to their bound channel. The `users:read` pair lets an agent resolve the user ids it sees in a conversation to names and profiles — the email field needs `users:read.email`. `reactions:read` lets an agent look up who reacted to a message and with what emoji. All three are optional: an install without `users:read` never registers the lookup tool at all, rather than exposing one that would always fail, and `reactions:read` gates the reaction-lookup tool the same way; an install with `users:read` but not `users:read.email` still resolves people, just without their email.) [`etc/slack/app-manifest.yaml`](../etc/slack/app-manifest.yaml) carries the full scope and event-subscription set — create the app from it to get everything, including the scopes that ambient mode needs.
2. Add slash command `/platform` pointing to your app.
3. Generate an app-level token (`xapp-...`) with `connections:write` scope. Deploy with both tokens:

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackBotToken=xoxb-... \
     --set=apiServer.slackAppToken=xapp-...
   ```

4. In the Platform UI, click the Slack icon on any instance and connect it to a channel (or `dam channel slack connect <agent> --channel-id <C0…> [--ambient]`).

**Agent name and avatar on replies:** with the `chat:write.customize` scope, agent replies post under the agent's name instead of the app's. The scope is opt-in. It is not in the provided manifest, and the install does not request it. To use it, add `chat:write.customize` to your Slack app's bot scopes and reinstall the app. It then takes effect for the workspace that the app's own bot token belongs to. For the agent's avatar to show too, set `--set=apiServer.imgbbApiKey=<key>` ([ImgBB API](https://api.imgbb.com)): Slack fetches message icons from the public internet, so the api-server uploads each avatar there as a PNG, named by a hash. Those images are public to anyone holding the URL.

**Upgrading an app you created earlier:** Slack never applies later manifest changes to an app that already exists, so an app predating a scope or event the platform has since started using keeps working while that one feature silently does nothing. Re-apply [`etc/slack/app-manifest.yaml`](../etc/slack/app-manifest.yaml) from the app's **App Manifest** page and reinstall when Slack asks. The bind link the bot offers when someone invites it to a channel needs the `member_joined_channel` subscription this way; without it the invite is simply ignored, with nothing logged.

### More than one workspace

Slack hands the bot token over by copy-paste for the app's own workspace only. Every other workspace has to complete Slack's install handshake, so to serve more than one:

1. In the Slack app, activate public distribution (Manage Distribution) and register `<urls.ui>/api/slack/install/callback` as an OAuth redirect URL. Slack never fetches that URL — the installing admin's browser does — so an internal host behind a VPN works and nothing has to be exposed.
2. Deploy with the app's client credentials (Basic Information → App Credentials):

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackClientId=... \
     --set=apiServer.slackClientSecret=... \
     --set=apiServer.slackEnterpriseId=...   # Enterprise Grid only; see below
   ```

   On Enterprise Grid, set `apiServer.slackEnterpriseId` to the organization id — a workspace outside it is then refused at the moment its credential would be accepted. Leave it empty on a standalone app, which is the only option there: Slack reports no organization for one. Connecting workspaces from two organizations at once is not supported either way — a Slack conversation id and a Slack user id each identify one thing only inside one organization.

3. Grant yourself the `keycloak.slackInstallerRole` realm role — the chart creates it along with a `slack-installers` group mapped to it, so adding yourself to that group in the Keycloak admin UI is enough. Connecting a workspace is install-wide, so only an operator may start one.
4. Open **Settings → Slack workspaces** and press *Connect a workspace*. The tab appears only for holders of that role. It answers with a `slack.com` consent URL and sends you there; `GET /api/slack/install/start` is the same thing for a script, returning the URL as JSON rather than redirecting, because a browser navigation carries no bearer token.
5. Approve it as an admin of the workspace you are adding, or hand the URL to someone who is — it is an invitation, good for 24 hours and spendable once. It is approved **while on the VPN**, because Slack redirects the browser back to the platform's own host; the workspace's bot token is then stored in a Kubernetes Secret. That admin needs no platform account.

This is an invitation rather than open enrollment, and the two are not interchangeable. Both sides consent: an operator decides the platform is willing to serve a workspace, and an admin of that workspace grants it. A consent redirect the platform did not invite is refused — including the "Sharable URL" Slack's own Manage Distribution page hands out, which carries no invitation, so that URL is not the way in.

Leaving `keycloak.slackInstallerRole` empty disables the install surface entirely — no routes, no tab — and the workspace `slackBotToken` was issued for keeps working either way.

Connecting a channel does not change: you still paste a conversation id. One thing does become stricter once a second workspace is connected: the conversation has to be one a connected workspace can actually see, because that is how its workspace is worked out. Public channels resolve whether or not the bot has been invited; a **private** channel needs the bot invited first, which posting required anyway. The platform works out which workspace it belongs to by asking each connected workspace about that conversation, preferring one the bot has been invited to. A channel shared into several workspaces is not a problem — they are the same conversation. Only an id no connected workspace can see is refused. A single-workspace install never makes that call.

The workspace that `slackBotToken` was issued for keeps working without any of this — it stays the fallback. Re-running the flow for a workspace re-authorizes it in place, which is how a workspace picks up scopes added to the app later; bindings and linked identities are untouched.

The binding is the authorization: anyone in the channel drives the instance under the instance's own credentials, no login required; Slack channel membership is the only per-person gate, and the owner's Terms-of-Use acceptance covers every turn.

A mention in a channel no instance is bound to gets an ephemeral rejection.

## Telegram Integration

Platform runs a single Telegram bot for the entire installation. A Telegram chat (DM or group) binds to at most one instance; the binding routes every message in that chat.

1. Create one bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Deploy with the token (and, recommended, the bot's handle): `--set=apiServer.telegramBotToken=<token> --set=apiServer.telegramBotName=<handle>`.
3. Connect a chat: add the bot to a chat (or message it directly) and send `/bind` (or just `/start`). In groups, only chat admins can start the flow. Complete the browser login and pick the instance.
4. The bot confirms in the chat.

**Access model** — connecting a chat is the owner's consent; anyone in the chat can drive the instance, no account needed. Every turn runs under the instance's own credentials, and `/unbind` in the chat disconnects it (the owner can also disconnect it from the web UI). Messages in unconnected group chats are ignored.

## Development mode

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run //packages/ui:run             # start UI dev server
```

Platform detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization. With a running systemd (or OpenRC) it runs the Lima provision scripts on the host; without one it installs the pinned k3s binary and starts it as a plain process, prefixed by `K3S_LAUNCHER` when the host needs a wrapper. On a node kernel without IPv6 the mesh dataplane is installed IPv4-only. Claude Code on the web needs that wrapper and more: see the [`ccweb`](../.agents/skills/ccweb/SKILL.md) skill.

### vm-backend agents (VM runner)

Agents created with `backend.type: vm` — chosen beside the image rather than by a template of its own, by an API caller directly or for every agent a flagged-in owner creates in the browser — run as smolvm microVMs inside a **VM runner** — a pod per owner that holds `/dev/kvm`, created by the controller, keeping that owner's machine disks on its own PVC. Such an agent persists the agent's home and nothing else: the rest of the machine is a root overlay discarded every time it stops. Turn it on with `virtualization.enabled=true`, which then requires two more values or the install refuses to render: `virtualization.runner.resources.limits.memory`, the limit the runner admits machines against, and `virtualization.runner.egressCidrs`, the only kernel gate behind a guest's own egress allowlist (say `[0.0.0.0/0]` with the cluster's ranges in `egressExceptCidrs` to leave it unconfined out loud). The devices reach the pod only as device-plugin resources — `virtualization.devicePlugin.enabled=true` ships a DaemonSet that advertises them on any node with `/dev/kvm`, and without it the pod asks for KubeVirt's `devices.kubevirt.io/kvm` and `/tun` instead. Every other knob, and what each one costs, is documented per field under `virtualization` in [`helm/values.yaml`](../helm/values.yaml); the shape it produces is described in [vm-runner](architecture/vm-runner.md). A published chart pins the runner image to the commit that last touched the runner's own sources rather than to the release, so an upgrade that leaves that image unchanged does not roll the runner: a roll stops every machine of that owner at once, and each of those agents loses the turn it was running. A chart rendered straight from git keeps the appVersion fallback and rolls the runner on every deploy. Locally, `mise run cluster:install -- --set=virtualization.enabled=true` creates the k3s Lima VM with nested virtualization (Apple silicon M3+ on macOS 15+) and stages the agent image archives on the node for the runners to mount, since there is no registry. Nested virtualization is create-time only — an existing VM needs `cluster:delete` and a reinstall to gain it.
