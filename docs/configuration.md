# Configuration

How to configure [Humr](../README.md) after installation: secrets for the credential gateway, Slack integration, and the development-mode toggle. For *what* Humr is and how it's built, see the [architecture docs](architecture.md).

## Secrets

Agents and other connections require API tokens to communicate with their providers. These secrets are managed through the OneCLI dashboard at [onecli.localhost:4444](http://onecli.localhost:4444).

OneCLI acts as a proxy — agents never see the secrets directly. Instead, OneCLI intercepts outgoing requests from agent pods and injects the appropriate credentials before forwarding them to the provider.

1. **Add a secret** — open the OneCLI UI and create a new secret. For Anthropic, you can use `claude setup-token` as the token value. For other connections, use Apps or Generic secret.
2. **Allow the secret for an agent** — in the OneCLI UI, grant the secret to the specific agent that needs it. Only requests from allowed agents will have credentials injected.

## Skills

Three kinds of source show up in the Skills panel:

- no badge — repos you added yourself; deletable.
- **Platform** (blue) — seeded by the cluster admin; read-only.
- **Agent** (purple) — declared by this instance's agent template; read-only.

Seed Platform sources via `skills.skillSources`, or per-template sources via `<templateKey>.skillSources` — same shape either way:

```yaml
skills:
  skillSources:
    - name: "Anthropic Skills"
      gitUrl: "https://github.com/anthropics/skills"

googleWorkspaceTemplate:
  skillSources:
    - name: "Google Workspace Skills"
      gitUrl: "https://github.com/anthropics/google-workspace-skills"
```

Users can also author skills in the Files panel and publish them upstream as pull requests via the Publish button on standalone skill rows. Publishing requires a GitHub connection in OneCLI.

## Slack Integration

Humr runs a single Slack app (Socket Mode) for the entire installation. Multiple instances can share a channel — the bot routes messages per thread.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `chat:write`, `files:write`, `reactions:write`, `commands`, `users:read`. (`files:write` powers outbound file attachments via the `send_channel_message` MCP tool — existing installations must add it and have admins re-approve.)
2. Add slash command `/humr` pointing to your app.
3. Generate an app-level token (`xapp-...`) with `connections:write` scope. Deploy with both tokens:

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackBotToken=xoxb-... \
     --set=apiServer.slackAppToken=xapp-...
   ```

4. In the Humr UI, click the Slack icon on any instance to connect it to a channel. Optionally configure an allowed-users list in instance settings.

**Identity linking** — users run `/humr login` in Slack to link their Slack account to Keycloak. Unlinked users are prompted automatically.

**Routing** — single-instance channels auto-route. Multi-instance channels show a dropdown to pick the target instance; the choice persists for the thread.

**Access control** — per-instance allowed-users list (empty = open to all channel members). Unauthorized users get an ephemeral rejection.

## Development mode

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run ui:run             # start UI dev server
```

Humr detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization.
