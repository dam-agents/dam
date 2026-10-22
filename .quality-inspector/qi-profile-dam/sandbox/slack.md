# Slack sandbox

A throwaway workspace where DAM's Slack app and a test person meet in one channel.
Never use a company workspace.

0. **Two e-mail addresses** — one for the workspace's owner, one for the test person.
   Slack sends a code to each, so both must receive mail.
   In Google Workspace (an administrator of the domain does this, at admin.google.com):
   - **One licensed user, two addresses (no second licence).** **Directory** → **Users** → **Add new user**: first name `QA`, last name `Sandbox`, primary email `qa-sandbox@<domain>`.
     Set a password, keep **Ask for a password change at the next sign-in**, and save.
     Then open that user → **User information** → **Alternate email addresses (email aliases)** → add `qa-human@<domain>`.
     Mail to the alias lands in `qa-sandbox`'s inbox, and Slack treats it as a separate person.
   - **Or two users**, `qa-sandbox@<domain>` and `qa-human@<domain>`, each added as above — two licences, two inboxes.
   - Sign in to the new user once at mail.google.com and set the new password.
     If the domain enforces 2-Step Verification, enrol the user now: Slack's codes arrive by mail, and a locked-out mailbox stops the setup.
   - Put the user into an organizational unit or group your policy allows for test accounts, and note it in your password manager with its purpose.
     Never use a personal or a colleague's address: whoever owns the mailbox owns the sandbox.

1. **Workspace.** slack.com/get-started → **Create a new workspace** with `qa-sandbox@<domain>`, for example `dam-qa-sandbox`.

2. **Channel.** Create a public channel, for example `#qi-e2e`.
   Its ID is at the bottom of the channel's details (`C…`): put it after `E2E_SANDBOX_SLACK_CHANNEL_ID=`.

3. **DAM's Slack app.** api.slack.com/apps → **Create New App** → **From a manifest** → this workspace.
   Paste DAM's manifest, `etc/slack/app-manifest.yaml` in the dam-agents/dam repository, as it is.
   - **Install to Workspace** (OAuth & Permissions), then copy the **Bot User OAuth Token** (`xoxb-…`): `E2E_SANDBOX_SLACK_BOT_TOKEN=`.
     Leave token rotation off: a rotating `xoxe.` token expires in twelve hours.
   - **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**, scope `connections:write` (`xapp-…`): `E2E_SANDBOX_SLACK_APP_TOKEN=`.
   - In `#qi-e2e`, invite the app: `/invite @DAM`.

4. **The test person.** Invite `qa-human@<domain>` to the workspace (**Invite people**), accept the invitation from that inbox, and join `#qi-e2e` with it.
   Signed in as that person, api.slack.com/apps → **Create New App** → **From a manifest** → this workspace, and paste:

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

   **Install to Workspace** as that person, then copy the **User OAuth Token** (`xoxp-…`): `E2E_SANDBOX_SLACK_HUMAN_TOKEN=`.
   Tests write and read in the channel as this person only.

5. All four values go into `/home/agent/work/env/credentials.env` through the agent's files on the platform — never in chat.

The nested DAM imports the bot token at install (`apiServer.slackBotToken`), so the workspace is connected without the install flow.
