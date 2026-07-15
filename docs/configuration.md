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

Seed Platform sources via `skills.skillSources`, or per-template sources via `agentTemplates.<name>.skillSources` — same shape either way:

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

## Slack Integration

Platform runs a single Slack app (Socket Mode) for the entire installation. Multiple instances can share a channel — the bot routes messages per thread.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `chat:write`, `files:read`, `files:write`, `reactions:write`, `commands`, `users:read`.
2. Add slash command `/platform` pointing to your app.
3. Generate an app-level token (`xapp-...`) with `connections:write` scope. Deploy with both tokens:

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackBotToken=xoxb-... \
     --set=apiServer.slackAppToken=xapp-...
   ```

4. In the Platform UI, click the Slack icon on any instance to connect it to a channel. Optionally configure an allowed-users list in instance settings.

**Identity linking** — users run `/platform login` in Slack to link their Slack account to Keycloak. Unlinked users are prompted automatically.

**Routing** — single-instance channels auto-route. Multi-instance channels show a dropdown to pick the target instance; the choice persists for the thread.

**Access control** — per-instance allowed-users list (empty = open to all channel members). Unauthorized users get an ephemeral rejection.

## Telegram Integration

Platform runs a single Telegram bot for the entire installation. A Telegram chat (DM or group) binds to at most one instance; the binding routes every message in that chat.

1. Create one bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Deploy with the token (and, recommended, the bot's handle): `--set=apiServer.telegramBotToken=<token> --set=apiServer.telegramBotUsername=<handle>`.
3. Connect a chat either way:
   - **From the UI**: pick an instance, click "Connect a chat…", and open the one-time link — tapping Start in Telegram completes the connection, no login needed.
   - **From Telegram**: add the bot to a chat (or message it directly) and send `/login` (or just `/start`). In groups, only chat admins can start the flow. Complete the browser login and pick the instance.
4. The bot confirms in the chat.

**Access model** — connecting a chat is the owner's consent; anyone in the chat can drive the instance, no account needed. Every turn runs under the instance's own credentials, and `/logout` in the chat disconnects it. Messages in unconnected group chats are ignored.

## Development mode

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run ui:run             # start UI dev server
```

Platform detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization.
