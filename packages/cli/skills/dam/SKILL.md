---
name: dam
description: >
  Drive the user's DAM deployment from this machine with the `dam` CLI: create, run, restart and delete their DAM agents, give them prompts and read the answers, move files in and out, and manage schedules, connections, network rules, approvals, channels, skills and spend.
  Use whenever the user asks to do anything on DAM or with one of their DAM agents, or mentions the `dam` command — even when they don't say "CLI".
  Covers installing the CLI, signing in, and the rule that you never see a secret: the user types every credential into a command you hand them.
---

DAM runs the user's AI agents in isolated sandboxes on a server.
The `dam` CLI on this machine is how you drive it: everything the DAM web app does has a `dam` command.
You act as the user, with the user's own rights, so treat every command as if the user typed it.

## Hard rules

1. **You never see a secret.**
   Never ask the user for an API key, token, password, client secret, private key or access key.
   Never read one from a file, an environment variable or the clipboard, and never put one in a command you run.
   When a step needs a secret, follow [Secrets](#secrets): print the command, let the user run it in their own terminal, then check the result.
2. **Never touch the user's DAM sign-in.**
   Don't read the CLI's state directory (`~/.local/state/dam/`), and don't print or export `DAM_TOKEN`.
   `dam auth status` is safe: it never prints tokens.
3. **Ask before anything you can't undo.**
   `dam agent delete` removes an agent and all its data.
   Confirm with the user first, then pass `--yes` yourself; without a terminal, destructive commands refuse to run without it.
4. **Approvals and the Terms of Use are the user's to decide.**
   Don't approve or deny a pending request, and don't accept the Terms of Use, unless the user told you to after seeing what is being asked.
5. **Parse `--json`, not tables.**
   Read commands take `--json`, and an empty list is `[]`.
   Table output is for showing to the user.

## Set up

### Install the CLI

Check with `dam --version`.
If the command is missing, install the CLI with the user's package manager — it needs Node.js 20 or newer (`node --version`):

```sh
npm install -g @dam-agents/cli
```

`pnpm add -g @dam-agents/cli` and `yarn global add @dam-agents/cli` work too.
To update, install `@dam-agents/cli@latest` the same way.

### Point it at the server

`dam auth status` lists the servers the CLI knows and which one is active.
If none is configured, ask the user for the address of their DAM deployment (the URL they open the web app at) — it is not a secret.

### Sign in

The CLI handles sign-in; the user approves it in their browser.

```sh
dam auth login --server https://dam.example.com
```

The command prints a URL and a short user code, opens the browser, and waits until the user approves.
Show the user the URL and the code, and tell them to approve it.
If the browser can't open here, add `--no-browser`.
The server is saved as the active one, so later commands don't need `--server`.

When already signed in, `dam auth login` refuses without a terminal; add `--force` only when the user wants to sign in again.
If any command later says the session expired, run `dam auth login` again.

### Check the version

`dam version` shows this CLI's version and the server's.
When the CLI is older than the server it warns and carries on; when it is older than the oldest version the server accepts, commands exit with code 3.
Either way, update the CLI.

### Terms of Use

If a command fails with "Terms of Use acceptance required", show the user `dam terms show` and let them decide.
Run `dam terms accept --yes` only after the user says they accept.

## Secrets

Some commands store a credential on DAM: a model provider key, an API key or header value, an OAuth client secret, a GitHub App private key, object storage keys, a new DAM API key.
The credential must go from the user to DAM without passing through you.

1. Work out the full command **without** the secret flag.
   For `dam connection connect` and `dam connection update`, the CLI asks for a missing required secret at a hidden prompt when a person runs it.
2. Print that command and ask the user to run it **in a terminal of their own** — not through you, and not with an in-chat shell such as a `!` prefix, which shows the output to you and has no hidden prompt.
3. Wait for the user to say it is done.
4. Check the result yourself, for example with `dam connection list --json`.

Some secrets can't be typed at the prompt:

- **A multi-line key** (a GitHub App private key in PEM) is passed from a file the user names: `--private-key "$(cat path/to/app.pem)"` on connect, `--value "$(cat path/to/app.pem)"` on update.
  Print the command with the user's path in it; don't open the file yourself.
- **An optional secret** (the client secret of the user's own OAuth app) is not prompted for: tell the user which flag to add, and let them type it.
- **A new DAM API key** (`dam auth token create`) is printed once on stderr to whoever runs the command, so the user runs it.

If a command you ran stops with `error: missing required input(s): --value` or similar, that is the CLI asking for a secret: switch to the steps above.
Don't put secrets in `dam agent create --env` either.
A custom header connection keeps the credential out of sight and can still hand it to the DAM agent as an environment variable (`--env-name`).

Connections that sign in through a browser need no secret from anyone, so you can run them yourself: `dam connection connect <provider>` and `dam connection reauth <connection>` open the browser for the user to consent, and wait.

## Addressing agents

Every command that targets an agent takes an **agent ref**: either its name or its ID (`agent-` followed by 16 hex characters).
Names match exactly and case-sensitively.
A ref that matches nothing or more than one agent exits with code 5; list the agents with `dam agent list --json` and use the ID.

## Without a terminal

Your shell has no terminal attached, and the CLI behaves accordingly:

- Destructive commands need `--yes` (see the hard rules).
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
  If `dam connection list` shows no model provider, the user connects one first ([Secrets](#secrets)).
- `--wait` returns once the agent is running, and stops early on an error or when there is no room to start it.

### Give an agent work

```sh
dam run my-agent -p "Summarise the open pull requests"
```

The answer streams to stdout, and stderr ends with the reason the turn stopped.
For a long prompt, use `--prompt-file <path>` (`-` reads stdin).
To continue the same conversation, pass `--session <id>`; `dam session list my-agent --json` gives the ids.

For long work, start it and come back later:

```sh
dam run my-agent -p "Run the full test suite and report" --async
dam run get my-agent <session-id> --wait
dam run cancel my-agent <session-id>
```

`--async` prints only the session id on stdout.
A run that outlasts `--timeout` keeps going on the agent, and the CLI prints its session id so you can check it with `dam run get`.

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

The CLI does everything the web app does.
If something still can't be done from the CLI, tell the user and point them to the web app rather than calling DAM's internal API yourself.
