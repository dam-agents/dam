---
name: qi-profile-dam
description: >-
  Product profile for testing DAM — the agent platform — with the quality-inspector agent (helm-k3s engine) — and what a tester should know about DAM from a user's point of view.
  Load when quality-inspector freezes acceptance criteria or writes tests for DAM.
---

# DAM — what a tester needs to know

DAM runs AI coding agents (Claude Code, Codex, Pi, Bob) in isolated environments.
The nested install is a fresh platform at `http://localhost:4444` with four test accounts from `credentials.env` (local accounts of the bundled sign-in service); the suite signs in as the owner.

## Test accounts

DAM has no teams or workspaces: every account owns its own agents, connections, schedules and artifacts, and sees another account's work only through what that account shares (an artifact link, a public agent, a shared connection).

| Role        | Account        | May                                                                                                  |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `OWNER`     | `qa-owner`     | everything a user may, plus the usage analytics report (an inspector)                                |
| `MEMBER`    | `qa-member`    | everything an ordinary user may with their own work; no usage report (a "We are sorry" page)         |
| `INSPECTOR` | `qa-inspector` | what `MEMBER` may, plus the usage analytics report                                                   |
| `OUTSIDER`  | `qa-outsider`  | the same as `MEMBER` — kept apart for checks that someone else cannot see or change the owner's work |

No account sees the Slack workspaces tab in Settings: the QA install sets no Slack app.
None of them can see, open or change another account's agents, connections, schedules or artifacts unless it was shared with them.
There is no read-only account: any signed-in user may create their own agents, so DAM provides no `VIEWER`.
Builds published before these accounts were added have only `qa-owner`; there another account cannot sign in, so a check that needs one is `blocked` on such a build, never failed.

## Vocabulary a user sees

- **Agent** — a running harness with its own workspace; created from a template or a starter kit, opened in a chat view, can hibernate and wake.
- **Starter kit** — a ready setup an agent is created from (connections, schedules, size).
- **Connection** — a stored credential (model provider, GitHub, Slack…) granted to agents.
- **Schedule** — a recurring task on an agent.
- **Artifact** — a work product an agent or user publishes, shareable by link.
- **Settings** — API keys, providers, connections, appearance, usage, schedules, about.
- **Home** — what changed since the user last looked; agents, usage, spend.

## What the nested install cannot do

- No outbound network from inside the nested cluster beyond the sandbox accounts below: real model providers (unless lent), Telegram, and any GitHub or Slack other than the sandbox's do not work.
  An AC that needs any of them is `testable: no — external dependency`, unless it only checks that the UI offers or records something.
- **Sandbox accounts** (`sandbox` in `profile.json`, set up at the inspector's onboarding) make two services real, each only when its credentials are set:
  - **GitHub** — one repository of a throwaway organization, `profile.sandbox_github_repo`, and a test GitHub user who owns it.
    An agent reaches it through a **GitHub** connection, made either way a user makes one:
    **Connect with GitHub** (OAuth), or a personal access token (Settings → Connections → GitHub → *Connect with a personal access token*), whose value is `E2E_SANDBOX_GITHUB_TOKEN` and which may only read the repository and write its issues.
    With OAuth the install's GitHub OAuth App is the sandbox's, so the form needs no client ID; the browser leaves DAM for GitHub's sign-in.
    Right after the step that sends it there, call `githubSignIn({ screen, browser })` from `suite/lib/sandbox.ts`: it signs in as the test user (password and a fresh authenticator code), gives the App's consent when GitHub asks, and returns once the browser is back on DAM.
    Never drive GitHub's pages yourself, never type a GitHub value in a test, and never open another GitHub page: only the sign-in's own pages are reachable.
    The connection then shows the test user's login (`sandbox.githubLogin()`) as its account; `sandbox.githubUser()` says whether this instance has the test user.
    Check what the agent did on GitHub through what DAM and Slack show — its reply, its chat — never by reading GitHub.
  - **Slack** — one channel of a throwaway workspace; DAM's Slack app is installed there and connected at install, so the workspace needs no install flow.
    An agent joins it under the agent's **Channels** → *Connect a Slack channel* with **Channel ID** `E2E_SANDBOX_SLACK_CHANNEL_ID`.
    The test person writes and reads there only through `suite/lib/sandbox.ts`: `botUserId()` to mention the agent, `personSays(text, threadTs?)`, `botReplies(ts)`.
    DAM drops the fourth bot or app post in a row in one conversation (a channel's top level, or one thread) until a person writes there, and the test person's posts count as app posts.
    So each request goes in a thread of its own: a root without a mention (`personSays(text)`), then the mention in that thread (`personSays(text, root)`), then `botReplies(root)`.
    A Mock agent answers a Slack mention in the thread with its scripted reply, without a model.
  - Filing an issue or deciding anything needs a real model: with `lend_model` on, the test creates an **Anthropic** connection whose key is the lent placeholder (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` in the test's environment), and the agent uses a Claude Code template.
    Without it, such ACs are `blocked`, naming `lend_model`.
  - A sandbox whose credentials are not set leaves its ACs `testable: no — external dependency`.
- Agents answer through the **Mock** harness template (a scripted mock agent, the profile's `mock_image`): it replies "Hello from the mock agent."
  to every prompt and never calls a model.
  An AC about what an agent says or decides is judged only on what the UI shows around that reply; with `mock_image` set empty, an AC that needs an agent to reply or run is `blocked`, not failed.
- The harness templates (Claude Code, Codex, Pi, Bob) boot the default image, which bakes their
  tools, but no real model provider is reachable (above), so an AC about such a harness's own
  replies is `testable: no — external dependency`; one that only checks what the UI offers or
  records for it stays testable.
- What a user creates with a free-text field (a schedule's prompt) needs an agent first; the agent's name is itself free text and shows wherever the agent is listed.
  The injection canary therefore names one Mock agent with its text (`canary` in `profile.json`) and deletes it.
- No service mesh: the VM's kernel cannot run Istio, so the nested install runs without it.
  Network isolation between agents is not enforced — an AC that one agent cannot reach or act as another is `testable: no — no mesh`.
- No email, no SSO federation, no real billing.

## Versions

Builds are chart versions: `0.0.0-main.<n>` after every merge to main, `X.Y.Z` releases.
Candidate `main` = the newest dev chart; baseline `release` = the newest release.

## CLI and API

The published CLI is the npm package `@dam-agents/cli` (`dam`).
In a test: install it into `work/suite`, set `DAM_SERVER` to the app URL and `DAM_TOKEN` to an API key the test's setup creates under Settings → API keys; `--json` on every read verb.
The HTTP API takes the same key as a bearer token.

## Channels

`candidate_channel`: `main` (default) \| `release`.
`baseline_channel`: `release` (default) \| `none`.
Releases before `0.2.20` cannot install without the mesh; the `release` channel already picks a later one.
