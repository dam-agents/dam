# Configuration

How to configure [Platform](../README.md) after installation: secrets for the credential gateway, Slack integration, and the development-mode toggle.
For *what* Platform is and how it's built, see the [architecture docs](architecture.md).

## Secrets

Agents and other connections require API tokens to communicate with their providers.
These secrets are managed through the Platform UI at [platform.localhost:4444](http://platform.localhost:4444).

The Envoy sidecar in each agent pod injects credentials on the wire — agents never see the secret bytes.
The api-server stores secrets as K8s Secrets labelled with the owner's `sub`; the controller mounts the matching set into the Envoy sidecar only.

1. **Add a secret** — open the Connections panel in the UI.
   For Anthropic, you can use `claude setup-token` as the token value.
   For other connections, use the OAuth flow for the provider or a Generic secret.
2. **Connect an OAuth app** — for GitHub, GitHub Enterprise, and other named providers, click Connect and complete the browser flow.
   The api-server stores the resulting tokens; the refresh-token loop re-mints them before expiry.

### Egress through a TLS-inspecting proxy

Each agent's gateway verifies the upstream before it injects a credential.
If something on the cluster's egress path intercepts TLS with its own CA (a corporate inspecting proxy, or the platform's own gateway when the platform runs inside one of its agents), every injected connection fails its handshake and the agent reports a 503.
Name that CA with `controller.gatewayUpstreamExtraCAs`: `--set-file controller.gatewayUpstreamExtraCAs=proxy-ca.crt`.
Gateways then trust it on top of the public roots, and agents trust it beside their gateway's CA, since the proxy also intercepts the hosts a gateway passes through untouched.
The api-server trusts it too, for its own outbound calls on the same path: Slack's Socket Mode and Web API, GitHub, and OAuth token exchanges.
A connection that carries its upstream's own CA still validates against that CA alone.
`mise run cluster:install` sets the value by itself when it runs inside one of the platform's vm agents.

### Agents that inject only addressed requests

A new agent requires **named connections**: its gateway injects a Connection's credential only when the request names the Connection, by its token placeholder or by its `/__platform_conn/<connection id>/` path prefix.
Every other request keeps its own credential, so tools that call the same services with their own credentials or none — Docker containers, nested agents, the browser panel — are left alone.
Only such an agent offers the browser panel.

With it off, a gateway injects a Connection's credential into every request to its host, replacing whatever credential the request carries, unless two Connections compete for the same header.
Agents created before named connections became the default keep their setting.

It is set per agent:

- **Agent settings:** *Inject only into addressed requests* under the agent's setup.
  Changing it there restarts the agent's gateway.
- **Starter kit:** `requireConnectionAddress: true` or `false` in `kit.yaml`; a kit that names neither gets the default, on.

Values the platform hands an agent already carry an address.
A Custom Header Connection that sets no environment variable must be reached through its path prefix on such an agent.

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

Users can also author skills in the Files panel and publish them upstream as pull requests via the Publish button on standalone skill rows.
Publishing requires a connected GitHub account.

## Object storage

Artifact content is stored in an S3-compatible object store.
The chart bundles a single-node SeaweedFS by default, so a fresh install needs no setup.
For production, point the platform at your own store instead — same shape as the external-database config (`apiServer.db`): a set endpoint wins over the shared local instance.

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

The api-server creates the bucket at startup if it is missing (grant CreateBucket, or pre-create the bucket to run with tighter credentials).
Disabling both the bundled store and the endpoint disables artifact storage — uploads fail with a clear error.

Artifact bytes move directly: agents upload to the store through their gateway using short-lived links the platform mints, so the size cap is policy, not a transport limit.
Set `apiServer.objectStorage.publicEndpoint` to a browser-reachable address (for external stores usually the same as `endpoint`) to have downloads redirect to the store as well; leave it empty and the api-server serves downloads itself — note it buffers each download in memory, so if you raise `apiServer.maxArtifactBytes` well past the default, set `publicEndpoint` too (and size the bundled store's volume to match).

## Knowledge base sharing

Sharing a knowledge base as a read-only MCP endpoint needs object storage configured (above) — snapshot bytes live in the store.
Caps are set under `apiServer.kbShares`:

- `perFileMaxBytes` (default 2 MiB) — largest single text file a publish includes.
- `totalMaxBytes` (default 200 MiB) — total text content per published snapshot.
- `maxFiles` (default 5000) — most files a publish includes before it fails loudly.
- `grepDeadlineMs` (default 2000) — hard deadline for one consumer grep or glob call; the worker thread running the consumer-supplied regex/glob is terminated when it lapses.
- `maxConnectionsPerOwner` (default 20) — most shared-knowledge-base connections one account may hold.

Consumers read shared snapshots over the **in-cluster harness route** (`/api/agents/:id/kb`), not the egress gateway, so the cluster's own service DNS must resolve (the standard CoreDNS setup — no extra configuration).
The same serving app is also reachable on the share host as a by-link endpoint for external MCP clients.

## Slack Integration

Platform runs a single Slack app (Socket Mode) for the entire installation.
A Slack channel binds to at most one instance globally; the binding routes every mention in that channel.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `files:write`, `groups:read`, `im:read`, `im:write`, `reactions:write`, `reactions:read`, `commands`, `users:read`, `users:read.email`.
   (`channels:read`, `groups:read`, and `im:write` power agent-initiated posts to other bot-member channels and direct messages; without them agents can still post to their bound channel.
   `im:read` lets the UI label a connected 1:1 DM with the person it is with; without it the DM shows as its raw id.
   The `users:read` pair lets an agent resolve the user ids it sees in a conversation to names and profiles — the email field needs `users:read.email`.
   `reactions:read` lets an agent look up who reacted to a message and with what emoji.
   All three are optional: an install without `users:read` never registers the lookup tool at all, rather than exposing one that would always fail, and `reactions:read` gates the reaction-lookup tool the same way; an install with `users:read` but not `users:read.email` still resolves people, just without their email.)
   [`etc/slack/app-manifest.yaml`](../etc/slack/app-manifest.yaml) carries the full scope and event-subscription set — create the app from it to get everything, including the scopes that ambient mode needs.

2. Add slash command `/platform` pointing to your app.

3. Generate an app-level token (`xapp-...`) with `connections:write` scope, register `<urls.ui>/api/slack/install/callback` as an OAuth redirect URL, and deploy with the app-level token and the app's client credentials (Basic Information → App Credentials).
   Slack never fetches the redirect URL — the installing admin's browser does — so an internal host behind a VPN works and nothing has to be exposed.

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackAppToken=xapp-... \
     --set=apiServer.slackClientId=... \
     --set=apiServer.slackClientSecret=... \
     --set=apiServer.slackEnterpriseId=...   # Enterprise Grid only; see below
   ```

4. Grant yourself the `keycloak.slackInstallerRole` realm role — the chart creates it along with a `slack-installers` group mapped to it, so adding yourself to that group in the Keycloak admin UI is enough.
   Connecting a workspace is install-wide, so only an operator may start one.

5. Connect the app's own workspace the way every workspace is connected (below).
   No bot token is pasted anywhere: each workspace's token comes from the install handshake and is stored in a Kubernetes Secret.

6. In the Platform UI, click the Slack icon on any instance and connect it to a channel (or `dam channel slack connect <agent> --channel-id <C0…> [--ambient]`).

**Agent name and avatar on replies:** with the `chat:write.customize` scope, agent replies post under the agent's name instead of the app's.
The scope is opt-in.
It is not in the provided manifest, and the install does not request it.
To use it, add `chat:write.customize` to your Slack app's bot scopes and re-run the install flow for each workspace.
For the agent's avatar to show too, set `--set=apiServer.imgbbApiKey=<key>` ([ImgBB API](https://api.imgbb.com)): Slack fetches message icons from the public internet, so the api-server uploads each avatar there as a PNG, named by a hash.
Those images are public to anyone holding the URL.
Without the scope, an agent's post goes out as the app and its text opens with an emoji and the agent's name in bold.
The emoji is a robot face.
To use the workspace's own emoji instead, upload one per agent avatar and turn on **Use custom emoji for agents** where the agent's Slack channel is connected or edited.
The fields beside each avatar are prefilled `<brand.short>-agent-1` to `-8` (for example `dam-agent-1`).

**Upgrading an app you created earlier:** Slack never applies later manifest changes to an app that already exists, so an app predating a scope or event the platform has since started using keeps working while that one feature silently does nothing.
Re-apply [`etc/slack/app-manifest.yaml`](../etc/slack/app-manifest.yaml) from the app's **App Manifest** page and re-run the install flow when Slack asks.
The bind link the bot offers when someone invites it to a channel needs the `member_joined_channel` subscription this way; without it the invite is simply ignored, with nothing logged.
The Stop button on an agent's working status needs the `agent_session_stopped` subscription the same way; without it Slack answers a press with "Stop isn't available for this agent".

The Stop button also needs Slack's agent messaging (`agent_view` in the manifest), which replaces the older `assistant_view`.
Slack refuses a manifest that declares both, so an app created from an earlier manifest is moved in its app settings: the **Agent** tab offers the update.
The switch is one-way, people in the workspace see it only after a hard refresh of Slack, and a distributed app may need Marketplace review again.
Until the app is moved, the working status still shows through the older assistant API, without a Stop button.

### Connecting a workspace

1. Open **Settings → Slack workspaces** and press *Connect a workspace*.
   The tab appears only for holders of the installer role.
   It answers with a `slack.com` consent URL and sends you there; `GET /api/slack/install/start` is the same thing for a script, returning the URL as JSON rather than redirecting, because a browser navigation carries no bearer token.
2. Approve it as an admin of the workspace you are adding, or hand the URL to someone who is — it is an invitation, good for 24 hours and spendable once.
   It is approved **while on the VPN**, because Slack redirects the browser back to the platform's own host; the workspace's bot token is then stored in a Kubernetes Secret.
   That admin needs no platform account.

Any workspace other than the app's own also needs public distribution activated on the app (Manage Distribution).

This is an invitation rather than open enrollment, and the two are not interchangeable.
Both sides consent: an operator decides the platform is willing to serve a workspace, and an admin of that workspace grants it.
A consent redirect the platform did not invite is refused — including the "Sharable URL" Slack's own Manage Distribution page hands out, which carries no invitation, so that URL is not the way in.

On Enterprise Grid, set `apiServer.slackEnterpriseId` to the organization id — a workspace outside it is then refused at the moment its credential would be accepted.
Leave it empty on a standalone app, which is the only option there: Slack reports no organization for one.
Connecting workspaces from two organizations at once is not supported either way — a Slack conversation id and a Slack user id each identify one thing only inside one organization.

Connecting a channel does not change: you still paste a conversation id.
One thing does become stricter once a second workspace is connected: the conversation has to be one a connected workspace can actually see, because that is how its workspace is worked out.
Public channels resolve whether or not the bot has been invited; a **private** channel needs the bot invited first, which posting required anyway.
The platform works out which workspace it belongs to by asking each connected workspace about that conversation, preferring one the bot has been invited to.
A channel shared into several workspaces is not a problem — they are the same conversation.
Only an id no connected workspace can see is refused.
A single-workspace install never makes that call.

Re-running the flow for a workspace re-authorizes it in place, which is how a workspace picks up scopes added to the app later; bindings and linked identities are untouched.

### Upgrading from a Helm bot token

Installs set up before the install flow existed pasted the app's own workspace's bot token into `apiServer.slackBotToken`.
Keep it set for one deploy: at boot the api-server asks Slack which workspace it belongs to, stores it as that workspace's Secret — unless that workspace already re-authorized through the flow, whose newer token is kept — and moves every channel binding made back then onto that workspace.
The api-server never serves the Helm value itself; once it has been imported, remove it.
The import is safe to repeat, so leaving the value set a while longer does no harm.

### Token rotation

Slack can issue bot tokens that expire after twelve hours and are renewed with a refresh token ([Slack's docs](https://docs.slack.dev/authentication/using-token-rotation/)).
Slack will not let you turn this off again once it is on, so try it on a dev app first.

1. Set `apiServer.slackClientId` and `apiServer.slackClientSecret` — renewing and exchanging tokens both sign with them.
2. Register a redirect URL in the Slack app (the install callback above is fine — Slack only checks that one exists), then turn on **Token Rotation** under **OAuth & Permissions**.
3. Set `--set=apiServer.slackTokenRotation=true`.
   Rotation is one switch on the app, but every workspace's existing token keeps not expiring until it is exchanged, one call per token.
   As soon as the Slack worker starts, the api-server exchanges each of them for a rotating one — every connected workspace, an imported Helm token included.
   Slack retires the old token as it answers, so from then on only the rotating pair in the workspace's Secret works.

Rotating tokens are renewed whether or not the flag is set, so setting it back to `false` has no effect on tokens already exchanged.
Do not paste a rotating token (`xoxe.xoxb-…`) from Slack's settings page into `slackBotToken`: it arrives without its refresh token, so the platform cannot renew it and it expires in twelve hours.
Connect the workspace through the install flow instead.

The binding is the authorization: anyone in the channel drives the instance under the instance's own credentials, no login required; Slack channel membership is the only per-person gate, and the owner's Terms-of-Use acceptance covers every turn.

A mention in a channel no instance is bound to gets an ephemeral rejection.

## Telegram Integration

Platform runs a single Telegram bot for the entire installation.
A Telegram chat (DM or group) binds to at most one instance.
In a direct chat the instance answers every message; in a group it answers messages that mention the bot or reply to it, and with ambient mode on it reads every message and chimes in when it can help.

1. Create one bot with [@BotFather](https://t.me/BotFather) and copy its token.
   In BotFather, turn the bot's **Group Privacy** off (Bot Settings → Group Privacy).
   With it on, Telegram shows the bot only commands and replies to its own messages in groups, so mentions and ambient mode do not work there; a bot that is a group's admin sees everything anyway.
   A bot already in a group must be removed and added again for the change to take effect there.
2. Deploy with the token (and, recommended, the bot's handle): `--set=apiServer.telegramBotToken=<token> --set=apiServer.telegramBotName=<handle>`.
3. Connect a chat: add the bot to a chat (or message it directly) and send `/bind` (or just `/start`).
   In groups, only chat admins can start the flow.
   Complete the browser login and pick the instance.
4. The bot confirms in the chat.
5. Optionally, in a group, a chat admin sends `/ambient on` to have the instance read every message; `/ambient off` turns it back to mentions and replies only, and `/ambient` alone shows the current mode.

**Access model** — connecting a chat is the owner's consent; anyone in the chat can drive the instance, no account needed.
Every turn runs under the instance's own credentials, and `/unbind` in the chat disconnects it (the owner can also disconnect it from the web UI).
Messages in unconnected group chats are ignored.

## Development mode

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run //packages/ui:dev             # start UI dev server
```

Platform detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization.
With a running systemd (or OpenRC) it runs the Lima provision scripts on the host; without one it installs the pinned k3s binary and starts it as a plain process, prefixed by `K3S_LAUNCHER` when the host needs a wrapper.
On a node kernel without IPv6 the mesh dataplane is installed IPv4-only.
Claude Code on the web needs that wrapper and more: see the [`ccweb`](../.agents/skills/ccweb/SKILL.md) skill.
A sandbox that can open `/dev/kvm` also runs vm-backend agents: `cluster:install` turns `virtualization.enabled` on there unless the values or `--set=virtualization.enabled=false` choose otherwise.
A sandbox that cannot open it gets none, and the install warns that they are off.
Such an agent can open `/dev/kvm` only when its Agent asks for nesting with `spec.backend.vm.nestedVirtualization: true`, or the install asks for every vm agent with `controller.agent.templateDefaults.nestedVirtualization=true`, on an install with `virtualization.runner.nestedVirtualization=true`: then that machine alone gets the node's virtualization extensions, where the node's KVM allows nesting, and its `NestedVirtualization` condition says whether it got them.
Changing the ask restarts that agent's machine and no other; changing the template default restarts every vm agent's machine that does not ask itself, and while it is on no Agent can opt out.
Nesting is the kernel default (`kvm_intel` and `kvm_amd` `nested=1`), and turning it off on a node takes a module reload, so the chart value is the switch.
It is off by default because a nesting guest reaches the host kernel's nested-virtualization code.
The api-server offers no way to ask, so only someone who can edit Agent resources can turn it on for one agent, and only the install for all of them.

### vm-backend agents (VM runner)

An install that can virtualize creates every new agent on the `vm` Backend, whichever path makes it ([features](architecture/features.md)).
In the cluster, each runs as a smolvm microVM inside a **VM runner** — a pod per owner that holds `/dev/kvm`, created by the controller, keeping that owner's machine disks on its own PVC.
A local install on an Apple silicon Mac has no such pod, unless it keeps the runner pods on nested virtualization: one runner outside the cluster serves every owner from the Mac's own hypervisor ([vm-host-runner](architecture/vm-host-runner.md)).
Such an agent persists the agent's home and nothing else: the rest of the machine is a root overlay discarded every time it stops.
Turn it on with `virtualization.enabled=true`, which then requires `virtualization.runner.resources.limits.memory`, the limit the runner admits machines against, or the install refuses to render.
It also needs cert-manager, which issues each runner's serving certificate from a CA of the runners' own that the chart renders beside them (`virtualization.runnerCA`).
The devices reach the pod only as device-plugin resources, and the chart ships no plugin: a plugin is per node, so a cluster runs one for every install on it.
By default the pod asks for KubeVirt's `devices.kubevirt.io/kvm`; `virtualization.runner.devices` names another plugin's resource instead — e.g. `squat.ai/kvm` from squat's generic-device-plugin, which local dev applies from `helm/extra/kvm-device-plugin.yaml`.
The runner pod runs in a user namespace, which puts two demands on its nodes.
The node's `/dev/kvm` must be mode 0666, systemd's own default, because the device keeps its host owner unmapped in the pod; Debian and Ubuntu lower it to 0660, which no runner can open.
The runner's claim, `virtualization.runner.storageClass`, needs a filesystem that supports idmapped mounts, such as ext4 or xfs on Ceph RBD; on CephFS or NFS the runner never starts.
Every other knob, and what each one costs, is documented per field under `virtualization` in [`helm/values.yaml`](../helm/values.yaml); the shape it produces is described in [vm-runner](architecture/vm-runner.md).
A published chart pins the runner image by digest rather than by the release, and a rebuild that changes nothing in the image keeps its digest, so an upgrade that leaves that image unchanged does not roll the runner: a roll stops every machine of that owner at once, and each of those agents loses the turn it was running.
A chart rendered straight from git keeps the appVersion fallback and rolls the runner on every deploy.
Locally, `mise run cluster:install` turns `virtualization.enabled` on by default where the host can run machines, and the chart's own default stays off.
On an Apple silicon Mac it runs them on one runner on the Mac's own hypervisor ([vm-host-runner](architecture/vm-host-runner.md)).
In a sandbox (`IS_SANDBOX`) it does so when the sandbox can open `/dev/kvm`.
On a Linux host outside a sandbox and on an Intel Mac it leaves them off, and says why at the start and the end of the install; under CI they are off unless asked for.
`--set=virtualization.enabled=false` (or the same key in the values file) turns them off, and `--set=virtualization.enabled=true` asks for them where the default would not.
The e2e install chooses for itself: off, unless `E2E_VIRTUALIZATION=1`.
With `PLATFORM_NESTED_VIRT=1` on a Mac, the install creates the k3s Lima VM with nested virtualization (Apple silicon M3+ on macOS 15+) and runs the runner pods in it, staging the agent images on the node for the runners to mount, since there is no registry.
Nested virtualization is create-time only — an existing VM needs `cluster:delete` and a reinstall to gain it; until then the default leaves vm agents off with a warning, and an explicit `virtualization.enabled=true` fails the install.
