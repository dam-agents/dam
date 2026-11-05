---
name: dam
description: >
  Drive this DAM install from inside your own machine with the `dam` CLI, which is already on your PATH and already signed in as its own Agent: list, create, configure, restart and schedule the person's Agents, see their approvals and spend, and read or add connections and skills.
  Use it whenever the person asks you to do something on DAM, or asks what is on it.
  Not for a chat or terminal attach, a headless run, or reading an Agent's files: those are the person's own doors, and `dam` refuses them here.
---

DAM runs AI agents in isolated sandboxes on a server.
You are the person's assistant, on this install, and `dam` is on your PATH: everything the DAM web app does has a `dam` command, and every command you run acts as the person you work for.

There is nothing to set up.
`dam` in this machine talks to this install over the machine's own path, so it needs no sign-in, no token and no configuration; run `dam --help` for the command groups and `dam <group> --help` for one of them.

## Hard rules

1. **You never see a secret.**
   Never ask the person for an API key, token, password or key material, and never put one in a command.
   A connection's secret is entered by the person on a DAM web page; `dam connection` opens it for them.
2. **Every change waits for the person's approval.**
   Reads and creates run at once.
   Anything that changes or removes something that already exists — a rename, a restart, a sleep, a disable, a delete, a schedule edit, a network rule, a new grant — is filed on their Home screen, and `dam` answers with the approval id and says it is waiting.
   Say that when you report back, and tell them what you asked for; never claim it is done.
   `dam approval wait <id>` reports what they decided.
   If they declined, nothing happened.
3. **Their decisions are theirs.**
   Do not approve or deny a pending approval, accept the Terms of Use, or manage API keys: `dam` refuses those to you.
   Tell the person what needs deciding instead.
4. **Not everything works from here.**
   `dam chat`, `dam session`, `dam run`, `dam ssh`, `dam file` and `dam import` refuse, because they need the person's own sign-in rather than your path.
   Say so, and leave that work to them.
5. **Parse `--json`, not tables.**
   Read commands take `--json`, and an empty list is `[]`.
   Table output is for showing to the person.

## What it covers

- **`dam agent`** — list, get, create, update (name, avatar, providers, harness, environment), restart, sleep, disable and enable the person's Agents.
- **`dam schedule`** — list, create and edit a scheduled task, run one now.
- **`dam approval`** — the queue of decisions the person has to make, and `wait` for one of yours.
- **`dam spend`**, **`dam metrics`**, **`dam telemetry`** — what an Agent or the person has spent, and a session's turns.
- **`dam connection`**, **`dam skill`**, **`dam kit`**, **`dam template`** — what an Agent can use, and what it can be built from.
- **`dam network`** — an Agent's standing egress rules; **`dam channel`** — its Slack and Telegram bindings.
- **`dam terms`** — read them for the person; accepting is theirs.

## Examples

```sh
dam agent list --json
dam agent get my-agent --json
dam agent create --name notes --template default
dam schedule list my-agent --json
dam approval list --status pending --json
dam approval wait agentchange:6f2c… --timeout 600
```

A change answers like this:

```
error: Waiting for your owner's approval: Change an Agent's settings. Run `dam approval wait agentchange:6f2c…` to see the outcome.
```

Report that, with what the change was, and stop there.
