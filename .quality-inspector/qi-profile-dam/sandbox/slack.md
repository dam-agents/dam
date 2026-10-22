# Slack sandbox

A throwaway workspace where DAM's Slack app and a test person meet in one channel.
Never use a company workspace.

1. **Workspace.** slack.com/get-started → **Create a new workspace**, with an address of your own, for example `dam-qa-sandbox`.

2. **Channel.** Create a public channel, for example `#qi-e2e`.
   Its ID is at the bottom of the channel's details (`C…`): put it after `E2E_SANDBOX_SLACK_CHANNEL_ID=`.

3. **DAM's Slack app.** api.slack.com/apps → **Create New App** → **From a manifest** → this workspace.
   Paste DAM's manifest, `etc/slack/app-manifest.yaml` in the dam-agents/dam repository, as it is.
   - **Install to Workspace** (OAuth & Permissions), then copy the **Bot User OAuth Token** (`xoxb-…`): `E2E_SANDBOX_SLACK_BOT_TOKEN=` — the bot token, not a user token on the same page.
     Leave token rotation off: a rotating `xoxe.` token expires in twelve hours.
   - **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**, scope `connections:write` (`xapp-…`): `E2E_SANDBOX_SLACK_APP_TOKEN=`.
   - In `#qi-e2e`, invite the app: `/invite @DAM`.

4. **The test person.** Invite a second account to the workspace — another address of yours, for example `you+member1@…` — and join `#qi-e2e` with it.
   Signed in as that person (a private window keeps the two accounts apart), api.slack.com/apps → **Create New App** → **From a manifest** → this workspace — a new app, never DAM's — and paste:

   ```yaml
   display_information:
     name: QI test person
   oauth_config:
     scopes:
       user: [chat:write, channels:history, channels:read]
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

   Its **App ID** (Basic Information) must differ from DAM's app: a token DAM's own app issued makes every test message look like DAM's own, and no agent answers it.
   **Install to Workspace** as that person, then copy this app's **User OAuth Token** (`xoxp-…`): `E2E_SANDBOX_SLACK_HUMAN_TOKEN=`.
   Never the User OAuth Token on DAM's app page, should it show one.
   Tests write and read in the channel as this person only.

5. All four values go into `/home/agent/work/env/credentials.env` through the agent's files on the platform — never in chat.

The nested DAM imports the bot token at install (`apiServer.slackBotToken`), so the workspace is connected without the install flow.
