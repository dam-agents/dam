---
name: dam
description: >
  Drive the user's DAM deployment from this machine with the `dam` CLI: create, run, restart and delete their DAM agents, give them prompts and read the answers, move files in and out, and manage schedules, connections, network rules, approvals, channels, skills and spend.
  Use whenever the user asks to do anything on DAM or with one of their DAM agents, or mentions the `dam` command — even when they don't say "CLI".
  Covers installing the CLI, signing in, and the rule that you never see a secret: the user types every credential on a DAM web page or into a command you hand them.
---

DAM runs the user's AI agents in isolated sandboxes on a server.
The `dam` CLI on this machine is how you drive it: everything the DAM web app does has a `dam` command.
You act as the user, with the user's own rights, so treat every command as if the user typed it.

This page describes `dam` CLI 0.2.25.
Before you rely on it, compare that with the CLI you have: see [Match this skill to the CLI](#match-this-skill-to-the-cli).

## Hard rules

1. **You never see a secret.**
   Never ask the user for an API key, token, password, client secret, private key or access key.
   Never read one from a file, an environment variable or the clipboard, and never put one in a command you run.
   When a step needs a secret, follow [Secrets](#secrets): run the command without it, and the user types it on a DAM web page the command opens.
2. **Never touch the user's DAM sign-in.**
   Don't read the CLI's state directory (`~/.local/state/dam/`), and don't print or export `DAM_TOKEN`.
   `dam auth status` is safe: it never prints tokens.
3. **Ask before anything you can't undo.**
   `dam agent delete` removes an agent and all its data, and `dam connection disconnect` deletes a stored credential that every agent it is granted to loses.
   Confirm with the user first, then pass `--yes` yourself; without a terminal, these commands refuse to run without it ([Without a terminal](#without-a-terminal) lists them).
4. **Approvals and the Terms of Use are the user's to decide.**
   Don't approve or deny a pending request, and don't accept the Terms of Use, unless the user told you to after seeing what is being asked.
5. **Parse `--json`, not tables.**
   Read commands take `--json`, and an empty list is `[]`.
   Table output is for showing to the user.
6. **Only the CLI talks to DAM.**
   Never call DAM's API directly — with curl, a script or anything else — and never reuse the CLI's sign-in to do so.
   See [When the CLI can't do it](#when-the-cli-cant-do-it).

## Set up

### Install the CLI

Check with `dam --version`.
If the command is missing, install the CLI with the user's package manager — it needs Node.js 20 or newer (`node --version`):

```sh
npm install -g @dam-agents/cli
```

`pnpm add -g @dam-agents/cli` and `yarn global add @dam-agents/cli` work too.
To update a global npm installation, run `dam update`, then match this skill to it again.

### Match this skill to the CLI

The user's DAM deployment serves the skill that matches its server.
When you know the server's address, install the skill from it, and read it again:

```sh
npx skills add https://dam.example.com -g
```

Then install the CLI version that `dam version --json` gives as `recommendedClientVersion`.
If it finds no skill there, the server is older than that; compare versions instead.

Compare the version at the top of this page with what `dam --version` prints:

- **The same**: this page describes your CLI.
- **The CLI is newer**: reinstall this skill at the CLI's version, `npx skills add 'dam-agents/dam/skills/dam#v<version>' -g`, with the version `dam --version` prints, and read it again.
- **The CLI is older**: update the CLI, then compare again.
  If the newest CLI is still older, this skill came from the repository's `main` branch and describes a CLI that is not released yet: commands and flags here may not exist in yours, or may work differently.
  Trust `dam <command> --help` wherever it disagrees with this page, and tell the user that the skill is ahead of their CLI.
  The first release with this skill is 0.2.24; an older CLI has no skill at its version.

### Point it at the server

`dam auth status --json` lists the servers the CLI has signed in to, which one is active, and whether each session is `valid` or `expired`.
If none is configured, ask the user for the address of their DAM deployment (the URL they open the web app at) — it is not a secret.

To make another saved server the active one, without signing in again:

```sh
dam auth switch https://dam.example.com
```

It takes the URL with or without a trailing slash, or just the host name.
A server the CLI has not signed in to exits with code 2 and lists the saved ones: sign in there with `dam auth login --server <url>`.
When the session there expired, the server still becomes active, and the command says to run `dam auth login`.
For one command against another saved server, without changing the active one, add `--server <url>` to that command.

### Sign in

The CLI handles sign-in; the user approves it in their browser.

```sh
dam auth login --server https://dam.example.com
```

The command prints a URL and a short user code, opens the browser, and waits until the user approves.
Show the user the URL and the code, and tell them to approve it.
If the browser can't open here, add `--no-browser`.
The server is saved as the active one, so later commands don't need `--server`.

When the saved session still works, `dam auth login` refuses without a terminal; add `--force` only when the user wants to sign in again.
If any command later says the session expired, run `dam auth login` again: an expired session does not count as signed in, so it needs no `--force`.
`dam auth status` marks such a session `session expired`.
If `dam auth login` still answers "already logged in" while other commands say the session expired (an older CLI does), run `dam auth login --force`.

### Check the version

`dam version --json` shows this CLI's version, the server's, the CLI version the server recommends, and the latest CLI on npm.
When `upToDate` is `false`, update the CLI.
When the CLI is older than the server recommends, commands warn and carry on; when it is older than the oldest version the server accepts, commands exit with code 3.

### Terms of Use

If a command fails with "Terms of Use acceptance required", show the user `dam terms show` and let them decide.
Run `dam terms accept --yes` only after the user says they accept.

## Secrets

Some commands store a credential on DAM: a model provider key, an API key or header value, an OAuth client secret, a GitHub App private key, object storage keys, a new DAM API key.
The credential must go from the user to DAM without passing through you.

For `dam connection connect` and `dam connection update`, the user types the secret on a DAM web page:

1. Run the command yourself, with every input except the secret.
2. The CLI opens a DAM page in the user's browser and waits; with `--no-browser` it prints the link instead, and you show the user that link.
   Tell the user to sign in as themselves, check what the page shows — the connection, its type and every host the secret is sent to — and enter the secret there.
3. The command ends when the user saves (exit `0`; `--json` gives the connection's ID), cancels, or lets the link expire after ten minutes (exit `1`).
   Run it again for a new link.
4. Read the `check` in the `--json` output before you tell the user the connection is ready.
   These connections are checked when they are saved: a GitHub token (`github-pat`, `github-enterprise-pat`), a GitHub App (`github-app`, `github-enterprise-app`), a Kubernetes token, and a model provider key.
   `"status": "passed"` names the `account`, so tell the user which account it is.
   A GitHub App's `account` is its bot (`<app>[bot]`), `installedOn` the user or organization it is installed on, and `repositories` the repositories it reaches (`repositoriesTruncated` when there are more): tell the user these.
   When `expiresAt` is set, tell the user when the token expires; the CLI warns when that is within a day.
   A Kubernetes token's `account` is the user it acts as, such as `system:serviceaccount:<namespace>:<name>`.
   `"failed"` or `"unchecked"` means the user saved it anyway after a warning: tell them the `reason` and that agents using it may be refused, and offer `dam connection update` to replace it.

The page takes a multi-line key (a GitHub App private key in PEM) as well, so don't build a `--private-key "$(cat …)"` command.
If the page warns that the secret will go to a host the template does not use, tell the user to cancel unless they asked for that host.

A command can't open the page for some secrets; then print the command for the user to run **in a terminal of their own** — not through you, and not with an in-chat shell such as a `!` prefix, which shows the output to you and has no hidden prompt — wait for them to say it is done, and check the result yourself, for example with `dam connection list --json`:

- **The user prefers a terminal**, or the server is older than the page (the CLI says `this server has no secret-entry page`): the command with `--prompt` asks at a hidden prompt.
- **An optional secret** (the client secret of the user's own OAuth app) is not asked for: tell the user which flag to add, and let them type it.
- **A new DAM API key** (`dam auth token create`) is printed once on stderr to whoever runs the command, so the user runs it.

If a command stops with `error: missing required input(s): --value` or similar, the CLI could not open the page there: switch to the terminal steps above.
Don't put secrets in `dam agent create --env` either.
A custom header connection keeps the credential out of sight and can still hand it to the DAM agent as an environment variable (`--env-name`).

Connections that sign in through a browser need no secret from anyone, so you can run them yourself: `dam connection connect <provider>` and `dam connection reauth <connection>` open the browser for the user to consent, and wait.

## Addressing agents

Every command that targets an agent takes an **agent ref**: either its name or its ID (`agent-` followed by 16 hex characters).
Names match exactly and case-sensitively.
A ref that matches nothing or more than one agent exits with code 5; list the agents with `dam agent list --json` and use the ID.

## Without a terminal

Your shell has no terminal attached, and the CLI behaves accordingly:

- These commands need `--yes` (see the hard rules):
  `dam agent delete`, `dam connection disconnect`, `dam schedule delete`, `dam import`, `dam skill source remove` and `dam satellite rm`;
  `dam network create`, `dam network update` and `dam network revoke` when the change restarts the agent's network gateway, and `dam network apply-preset --preset all`.
  `dam terms accept` needs it too, and only after the user accepts (hard rule 4).
- `dam chat <agent>` attaches to the agent's interactive session and `dam agent create-interactive` walks through a form; both need a terminal, so offer the command to the user instead.
- A prompt the CLI would show a person becomes an error that names the flag to pass.

## Common tasks

Run `dam <command> --help` for every flag; it is the authority when it disagrees with this page.

### Look around

```sh
dam agent list --json
dam agent get my-agent --json
dam template list
dam connection list
```

### Create an agent

```sh
dam agent create my-agent --wait --json
```

- `--template <id>` picks a template from `dam template list`; without it the deployment's default is used.
- `--provider <connection>` picks the model provider connection; without it the user's preferred one is used.
  `dam connection list --providers` lists the model providers: the PROVIDER column names each one's alias and the harnesses that run on it, and marks the preferred one (`provider.preferred` in `--json`).
  If it lists none, the user connects one first ([Secrets](#secrets)); `dam connection templates --providers` lists the kinds there are.
  To change the providers or the default model later, see [Models and harnesses](#models-and-harnesses).
- `--wait` returns once the agent is running, and stops early on an error or when there is no room to start it.

### Give an agent work

```sh
dam run my-agent -p "Summarise the open pull requests"
```

The answer streams to stdout, and stderr ends with the reason the turn stopped and the session id, as `session: <id>`.
For a long prompt, use `--prompt-file <path>` (`-` reads stdin).
To continue the same conversation, pass that id as `--session <id>`.
`--json` prints one object on stdout at the end instead of streaming: `{ status, sessionId, stopReason, text }`.

For long work, start it and come back later:

```sh
dam run my-agent -p "Run the full test suite and report" --async
dam run get my-agent <session-id> --wait
dam run cancel my-agent <session-id>
```

`--async` prints only the session id on stdout (with `--json`, `{ status: "pending", sessionId }`).
A run that outlasts `--timeout` keeps going on the agent, and the CLI prints its session id so you can check it with `dam run get`.

A new run starts on the agent's default harness and model.
To choose for one run, pass `--harness`, `--model` or `--setting`; see [Models and harnesses](#models-and-harnesses).

### What is my agent doing?

```sh
dam session list my-agent
dam session show my-agent <session-id>
dam session show my-agent <session-id> --follow
```

`dam session list` finds the session; `--json` marks the one whose turn runs with `running: true`.
`dam session show` prints when the running turn started and how long it has been going, then the session's messages and tool calls, newest last: each tool call with its tool, a summary of its command or input, its status and its duration.
It works for every session: one a person drives, one from Slack or Telegram, or one a schedule started.
`--json` prints one object, `{ session, turn: { running, turnStartedAt, turnElapsedMs }, steps }`.
`--follow` keeps printing new steps and the end of the turn until you stop it (Ctrl+C); with `--json`, one object per line.
A long tool call is often the reason a turn is slow: look at its duration, or at the one still `in_progress`.

### Models and harnesses

Every session of an agent runs on a **harness** (the coding agent inside it, such as `claude-code` or `codex`) and a **model** from a **model provider** connection granted to the agent.
The agent keeps a default for each kind of session: chat (also `dam run`), channel (Slack and Telegram) and scheduled.
A channel or scheduled default that is not set is the same as chat.

```sh
dam agent get my-agent --json
dam agent models my-agent
dam agent update my-agent --model ibm/gpt-5.5
dam agent update my-agent --harness codex --model openai/gpt-5.5 --setting effort=high
dam run my-agent -p "Review the diff" --model ibm/gpt-5-mini
```

- `dam agent get` shows the granted providers, the harnesses and the defaults; under `--json` they are in `models`.
  A default with a `null` model, or "not set" in the table, means runs fail until one is chosen.
- `dam agent models` lists the models the agent's providers offer for its default harness (`--harness` for another), named the way `--model` takes them: `<provider>/<model id>`.
  A provider that has not listed its models yet is named in a note; ask again in a minute.
- `dam agent update` changes only what you pass.
  `--provider <connection>` grants a model provider and `--remove-provider <connection>` takes one away; `dam connection list` names them.
  `--kind channel` or `--kind scheduled` changes that default instead of chat's, and `--same-as-chat` makes it follow chat again.
  Changing the agent's defaults is a change to the user's agent, so ask first unless the user told you to.
- `dam run` with `--harness`, `--model` or `--setting` chooses for that one run and leaves the defaults alone.

When a run fails because the session has no model, the agent has no default model: run `dam agent models my-agent`, then pass one with `--model`, or ask the user whether to save it as the default with `dam agent update`.
When it fails because no provider is granted, run `dam connection list`; grant one the user already has with `dam agent update my-agent --provider <connection>`, or have the user connect one ([Secrets](#secrets)).

### Name and avatar

```sh
dam agent avatars
dam agent update my-agent --name "Release helper"
dam agent update my-agent --avatar compass
dam agent update my-agent --avatar-file ./logo.png
dam agent update my-agent --avatar-default
```

- `dam agent avatars` lists the built-in characters and which ones the user unlocked; a character unlocks when the user finishes a Getting Started task in the web app.
  `--avatar` takes an unlocked character, or one emoji.
- An emoji (`--avatar 🦊`) and an image (`--avatar-file`, a JPG or PNG of at most 2 MB) need custom avatars, which `dam agent avatars` shows as on or off; the user turns them on under Features in the web app's settings.
- `--avatar-default` goes back to the character picked from the user and the agent's name.
- `dam agent create` takes the same avatar flags, and `dam agent get` shows the avatar.

### Files

```sh
dam file list my-agent -R
dam file get my-agent reports/summary.md --stdout
dam file put my-agent ./data.csv inputs/data.csv
dam import my-agent ./project --yes
```

Paths are relative to the agent's workspace.
`dam import` merges local files and folders into the agent's `work/` folder.

### Lifecycle

```sh
dam agent restart my-agent --wait
dam agent disable my-agent
dam agent enable my-agent
dam agent delete my-agent --yes
```

`dam agent disable` keeps the agent asleep until `dam agent enable`; `dam agent delete` is permanent, so confirm first.

### Schedules

```sh
dam schedule create my-agent --name nightly --task "Check the dashboards" --daily 22:00
dam schedule create my-agent --name standup --task "Summarise" --every 30m --weekdays MO,WE,FR
dam schedule create my-agent --name notes --task "Prepare the notes" --once --at "2026-10-01 08:30"
dam schedule list my-agent --json
dam schedule update <schedule-id> --every 1h
dam schedule disable <schedule-id>
dam schedule delete <schedule-id> --yes
```

A schedule that only checks whether something changed should carry `--precheck <command>`: it runs in the agent's workspace before each occurrence, exit `0` runs the task, exit `1` skips it at no cost, and any other exit runs the task anyway.

### Connections

```sh
dam connection templates
dam connection list my-agent
dam connection grant my-agent --connection github
dam connection revoke my-agent --connection github
```

A connection belongs to the user; granting it lets one agent use it.
Creating one, rotating its credential, and removing it are `dam connection connect`, `dam connection update` and `dam connection disconnect`; read [Secrets](#secrets) before the first two.
`dam connection disconnect` can't be undone: confirm with the user, then pass `--yes` (hard rule 3).
Without `--yes` it names the agents that would lose the connection.

A GitHub sign-in (`github`, `github-enterprise`) or a GitHub App installation (`github-app`, `github-enterprise-app`) holds the credential, and no agent is ever granted one.
Agents are granted the connections made from it, each with its own scope: an account, repositories and permissions.
`dam connection list` shows each sign-in or installation with the connections made from it underneath; in `--json` it has `"isParent": true`, and each connection made from it has a `parentId`.
A sign-in and its first connection often share a name, and that name means the connection, except after `--from`: elsewhere, name the sign-in or installation by its id.

A grant gives the agent everything the connection reaches, so choose what a GitHub connection reaches when you make it:

```sh
dam connection connect github --account acme --repositories api,web --permissions contents:read,pull_requests:write
dam connection connect github-app --app-id 123456 --installation-id 987654 --repositories api
dam connection connect --from github --account acme --repositories docs --name github-docs
dam connection scope github --json
dam connection scope github --repositories api
```

Without a scope, `dam connection connect github` keeps the sign-in alone and shows what it reaches; then make its connection with `--from`.
`dam connection connect --from <sign-in-id>` makes another connection next to those the sign-in or installation has, instead of replacing one.
`--full-access` gives a connection everything its sign-in or installation reaches: every account, repository and permission.
Pass it only when the user asks for that, and tell them what it reaches.
`dam connection list` marks such a connection `FULL ACCESS`, and in `--json` its `scope` is `{ "restricted": false, "fullAccess": true }`.

`dam connection scope <connection>` with no flags changes nothing: it shows the current scope and, under `available`, the accounts, repositories and permissions you can choose from.
A flag you leave out keeps that part of the scope.
A connection made from a sign-in reaches one account, given with `--account`; when the app is installed on one account only, you can leave it out.
A GitHub App is checked again with a token minted for the new scope: after a change with `--repositories` or `--permissions`, read the `check` in the `--json` output.

`dam connection disconnect <sign-in-id>` removes the sign-in or installation and every connection made from it.
Without `--yes` it names each of those connections and the agents that lose it: show the user that list before you pass `--yes`.
`dam connection reauth <connection>` signs in again for the connection's sign-in, which renews every connection made from it.
An installation's private key is replaced with `dam connection update <installation-id>`.

When a DAM agent's calls with a connection fail, for example GitHub answers `401 Bad credentials`, check the stored credential before you look elsewhere:

```sh
dam connection test github-pat --json
```

It exits `0` when the check passed and `1` when it failed or could not run, with the `reason` in `check`; the result also shows in `dam connection list --json`.
A token or key that expired or was revoked is replaced with `dam connection update`.

### Network rules and approvals

A DAM agent reaches outside hosts only through rules, and asks the user when it hits one it has no rule for.

```sh
dam network list my-agent
dam network create my-agent --host api.example.com --yes
dam approval list --json
```

`dam approval approve <id>` and `dam approval deny <id>` answer a pending request.
For a network request they write a permanent rule for its host, method and path unless you pass `--once`, which answers only this one request.
A request to go past a spend limit is an approval too: approving it allows one more limit amount of spend today.
A rule a DAM agent proposed ahead of need is one too: approving it writes that rule, denying it writes none.
Show the user what the request is and act only on their answer (hard rule 4).

### Channels

```sh
dam channel available
dam channel list my-agent
dam channel slack connect my-agent --channel-id C0123ABCD
```

A Telegram chat is bound from inside the chat with the bind command, not from the CLI.

### Skills on DAM agents

These manage the skills a DAM agent carries, not the skills you have.

```sh
dam skill source list
dam skill catalog <source>
dam skill install my-agent --source <source> --name <skill>
dam skill list my-agent
```

### Spend

```sh
dam spend status my-agent
dam spend daily --days 30
dam spend limit set my-agent --usd 10
dam metrics my-agent
dam telemetry show my-agent --session <session-id>
```

### Satellites

`dam satellite` (experimental) lets a DAM agent call tools on this machine, and keeps running while it serves them.
It exposes the user's machine, so start one only when the user asks for it.

## Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Success                                                                 |
| 1    | Failure; the message on stderr says why                                 |
| 2    | Invalid input, including a missing flag the CLI would have prompted for |
| 3    | This CLI is older than the server accepts; update it                    |
| 4    | `dam auth status` found no valid sign-in                                |
| 5    | The agent ref matched no agent, or more than one                        |
| 6    | No network rule with that id                                            |
| 7    | The agent could not be woken; stderr gives the reason                   |
| 8    | The approval can't be answered any more: already resolved or expired    |
| 9    | No schedule with that id                                                |
| 10   | `dam terms status`: the current Terms of Use are not accepted           |
| 11   | `dam run`: the turn ended some other way than finishing, e.g. cancelled |
| 12   | `dam run`: not finished within `--timeout`; it keeps running            |
| 130  | Interrupted                                                             |

## When the CLI can't do it

The CLI is meant to do everything the web app does, so a task it can't do is a gap in the CLI.
Don't work around it through the API (hard rule 6).
Tell the user which command or flag is missing, so the gap can be closed, and point them to the web app to do it for now.
If the CLI may just be old, update it first and check `dam <command> --help` again.
