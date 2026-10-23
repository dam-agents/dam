# Slack sandbox — the second test person

A second test person in the Slack sandbox's workspace and channel (`sandbox/slack.md`), for checks with two people in one conversation.
Set up the Slack sandbox first.
It is optional: leave its line empty, and a check that needs two Slack people is `testable: no` while every other check runs.

1. **The person.** Invite a third account to the workspace — another address of yours, never the first test person's or the one that installed DAM's app — and join `#qi-e2e` with it.

2. **Its app.** Signed in as that person (a private window keeps the accounts apart), api.slack.com/apps → **Create New App** → **From a manifest** → this workspace — a new app, never DAM's and never the first person's — and paste:

   ```yaml
   display_information:
     name: QI test person 2
   oauth_config:
     scopes:
       user: [chat:write, channels:history, channels:read]
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

   **Install to Workspace** as that person, then copy this app's **User OAuth Token** (`xoxp-…`).

3. **The line.** Put it after `E2E_SANDBOX_SLACK2_HUMAN_TOKEN=` in `/home/agent/work/env/credentials.env` through the agent's files on the platform — never in chat.

`bin/sandbox check` fails when this token is the same Slack account as the bot or the first person.
