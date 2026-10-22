---
name: spawn-subagent
description: Spawn platform sub-agents on DAM — fresh agents in their own sandboxes that run one task and return a schema-validated result.
  Use when asked to spawn, delegate or hand off to a sub-agent or a throwaway agent, run work on another harness or in isolation, fan work out to fresh agents, or run a make/test/eval step and expect a typed result.
  Its first step decides whether a platform sub-agent is needed at all.
  Hand-offs, fan-outs and long waits use the spawn_subagent and await_subagents tools; a driver SDK script (Python driver_sdk, JS driver-sdk.mjs) is only for orchestration logic that finishes in one foreground command.
allowed-tools: mcp__platform-outbound__spawn_subagent, mcp__platform-outbound__await_subagents, mcp__platform-outbound__list_harnesses, mcp__platform-outbound__list_connections, mcp__platform-outbound__get_budget, Bash(python3 *), Bash(node *), Write
---

# Spawn a sub-agent

The platform can **spawn a sub-agent**: start a fresh agent in its own sandbox that runs one prompt to completion, reports one result, and is then removed.
You (the driver) hand it a prompt plus the result shape you expect, and get the validated result back.
It runs unattended and cannot ask you anything.

## Step 1 — Decide: is a platform sub-agent needed?

Do this first, every time.
A platform sub-agent starts a new sandbox — tens of seconds to minutes before it runs, with compute counted against the budget.
Your harness's own subagent, if it has one, runs in this sandbox, starts in seconds and costs no extra compute.
Go through the needs below.
**If none applies, do not spawn: use your harness's own subagent if it has one, or do the work yourself.** If one applies, carry on and name it in `needs` when you spawn:

- `different-harness` — it must run on another harness;
- `own-setup` — its own repository to clone, an install command, env or skills;
- `more-resources` — more CPU, memory or disk than this sandbox, or a microVM for a container runtime or a cluster;
- `isolation` — the work must not be able to touch this workspace;
- `parallel` — heavy parallel work beyond what this sandbox can run;
- `checked-result` — a result the platform checks against a schema.

The platform refuses a need the request does not bear out: `different-harness` on your own harness, `own-setup` without seed, install, env or skills, `more-resources` without resources or a vm backend.
"The user said sub-agent" is not a need: unless they named the platform, a harness or a sandbox, they mean work done in this sandbox.

## Step 2 — Delegate with the tools

The tools are the way to delegate: for one hand-off, for a fan-out, and for any wait that may be long.

1. **Choose what it runs on — do not guess.** Call `list_harnesses` and `list_connections` and show the human what is available.
   If it is not obvious which to use, **ask them**.
   `list_harnesses` names the provider each harness would run on, or the provider this agent lacks for it: tell the user what to attach rather than spawning there.
   A sub-agent on your own harness runs on this session's model and settings; on any other harness, pass `model` (one `list_harnesses` lists for it), or the spawn is refused.
   When the user set this session's platform sub-agents to a harness, model, mode or effort, those bind: a `harness` you omit is that one, another is refused, and the spawn result names what was set.
2. **Spawn.** Call `spawn_subagent` with `needs` (from step 1), `prompt`, `schema` (JSON Schema, e.g. `{"type": "integer"}`) and `harness`, plus any setup option from the table below and, to pick the model, `model`, `mode` and `configOptions` as in "Choose the model per spawn".
   Never pick a model through `env`: the platform then records no harness config and runs none of its checks.
   It returns the sub-agent id at once.
3. **Wait.** Call `await_subagents` with the ids.
   It returns as soon as one finishes, or after about four minutes, with what is done, failed and still running; call it again with the running ids.
   A connection or transport error from the call does not stop the sub-agents: call it again with the same ids.

For a fan-out, call `spawn_subagent` once per task, then wait on all the ids in one `await_subagents` call.

**You may stop waiting.** If you end your turn or stop calling `await_subagents`, the platform delivers each result to this session as a new turn when its sub-agent ends — on every harness, and also after the user has left.
So never keep a shell command or a background job alive only to wait for a sub-agent.

**Report only what you checked.** Never tell the user that a sub-agent or a script is running unless you checked it just now.
`await_subagents`, or the script's own output, is the source of truth.
A shell job left in the background can die at once on some harnesses, while it still looks started.

## Orchestration logic: a script

Use a script only when the delegation has logic of its own — a loop, or scoring one sub-agent's output with another — and it finishes inside one shell command.
Run it in the foreground and let it print its results.
Your shell tool may stop a command at its own default timeout (Claude Code's after 2 minutes), so give the command a timeout longer than the script can take; if you cannot, use the tools.
**A script's results reach nobody if the script stops early**: the platform delivers results as a turn only for tool spawns, so the results of a script that dies or is cut off are lost.
Write durable output (a file in `~/work`, a git ref) so a rerun is cheap.
The options below mean the same in both: the tools take them as camelCase JSON (`ttlMs`, `env` as `[{name, value}]`).

### The SDK

The same SDK ships in two languages, both dependency-free and self-configuring from the pod (no URL or token to pass):

- **Python** — `import driver_sdk as d` works in any `python3` on this image.
- **JS** — `import { spawn, listImages, listConnections, s } from "/usr/local/lib/driver-sdk.mjs";`

Examples below are Python; the JS names are the camelCase equivalents (`listImages`, `ttlMs`, …) and take one options object.

- **Look first** — run `d.list_images()` and `d.list_connections()` and show the human what is available, as with the tools.
- **What it runs on** — `harness=` one of `claude-code`, `codex`, `pi`, `bob`, `copilot`, on that harness's default image and size.
  `image="<full ref>"` runs a custom image instead, with `harness` saying which harness is inside it; prefer `seed` and `install` below over building an image.
- **Model** — one of your model providers that the harness runs on, and a model you pick (see "Choose the model per spawn").
  A spawn with no model runs on this agent's default model when it is on that default's harness; on any other harness, or with no default, it is refused.
- **Connections** — only your own grants, for what the task needs beyond the model; its network access follows your egress rules, so what you can reach, it can reach.

## Quickstart: a sub-agent that returns a single integer

```python
# spawn_demo.py
import driver_sdk as d

answer = d.spawn(
    "Compute 6 * 7 and report the result as a single integer.",
    "integer",               # the result must be one integer
    harness="codex",         # any harness list_images() names
    label="demo",
)
print("returned:", answer)   # 42
```

Run it in the foreground, with a long enough timeout: `python3 ~/spawn_demo.py`.
`spawn()` blocks until the sub-agent reports a result that passes validation, then returns it.
Progress lines (`[invoke] spawned demo (agent-xxx)`, `… done`) print to stderr.

## Setting up the sub-agent

A sub-agent is set up the way a starter kit sets up an agent, so it does not need a custom image for tooling:

```python
result = d.spawn(
    "Run one evaluation cell and report its verdict.",
    {"passed": "boolean", "note": "string?"},
    harness="pi",
    connections=[ghe_connection_id],             # clone access, from list_connections()
    seed={"url": "https://github.example/acme/tool", "commit": my_commit},
    install="uv venv && uv pip install ./tool",  # runs in the workspace before the prompt
    env={"MODE": "cell"},
    resources={"cpu": "2", "memory": "4Gi", "storage": "10Gi"},
    ttl_ms=4 * 3600_000,
    label="cell:persona/task",
)
```

| option        | meaning                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `seed`        | Repository cloned into the workspace: `url`, optional `ref` or `commit`, `into` (`"work"` default or `"home"`). Pin `commit` to the commit you are running from, so it runs the same code. |
| `install`     | Shell command run once in the workspace before the prompt. Must finish within 15 minutes; longer setup belongs in an image.                                                                |
| `env`         | Environment variables (Python: a dict; JS: `[{ name, value }]`).                                                                                                                           |
| `resources`   | `cpu`, `memory`, `storage` (disk). Omitted values come from the harness's defaults.                                                                                                        |
| `backend`     | `"vm"` for a microVM, when the work needs a container runtime or a cluster inside.                                                                                                         |
| `skills`      | External skills to install: `[{"source": <skill source url>, "name": ...}]`.                                                                                                               |
| `connections` | Connection ids to grant, a subset of your own.                                                                                                                                             |
| `image`       | A custom image to run instead of the harness's default one.                                                                                                                                |
| `label`       | Names the sub-agent in your script's log lines.                                                                                                                                            |
| `ttl_ms`      | Deadline, ~1 min..6 h, default ~60 min. See below.                                                                                                                                         |

A **seed or install that fails fails the spawn at once** with the reason (for example `install failed: …`), so a broken setup costs seconds, not the whole deadline.

**Pick `ttl_ms` per sub-agent — it is your fast-fail lever.** It is a kill deadline, not pacing: the sub-agent is removed the moment it lapses, mid-work or not.
A quick compute or gate gets a short one (`10 * 60_000`); a clone + build + large change gets a long one.
Time spent queued for compute counts too.

**Give a heavy sub-agent more memory.** The harness default (often 1Gi) OOM-kills a clone plus install or build.
An OOM-killed sub-agent fails fast with its reason.

## Choose the model per spawn

One harness runs any model its providers offer, so pick the model per spawn: run one task on two models to compare the results and the cost, or put mechanical steps on a cheap model and hard ones on a strong one.
`model=`, `mode=` and `config_options=` (JS: `model`, `mode`, `configOptions`) take the values the agent's Config panel offers.
They are written into the sub-agent's harness config before its first turn.

```python
cheap = d.spawn(prompt, schema, harness="claude-code", model="ibm/aws/claude-haiku-4-5", mode="bypassPermissions")
strong = d.spawn(prompt, schema, harness="codex", model="ibm/azure/gpt-5.5", config_options={"effort": "high"})
```

| harness       | `model`                                                                         | `config_options`                                  |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| `claude-code` | `<provider>/<model id>` from the agent's model list (`claude/` prefix accepted) | `effort`: `low` … `xhigh` (Haiku takes none)      |
| `codex`       | `<provider>/<model id>` from the agent's model list                             | `effort`: `minimal` … `xhigh`                     |
| `pi`          | `<provider>/<model id>` from the agent's model list                             | — (`mode` is its thinking level: `off` … `xhigh`) |
| `bob`         | `<provider>/<model id>` from the agent's model list                             | `approvals`: keep `auto`                          |
| `copilot`     | `<provider>/<model id>` from the agent's model list                             | —                                                 |

"The agent's model list" is what the session picker shows for the harness: every model named with its provider (`ibm/aws/claude-opus-4-8`, `anthropic/claude-sonnet-5-5`).
Tier names such as `haiku` or `sonnet` are not models and are refused.

- **A model the harness does not list on this agent is refused before the sub-agent exists**, naming the listed ones.
  A provider that serves no model to the target harness (the Anthropic subscription on `codex`) is refused the same way.
- **When the user set a model for this session's platform sub-agents, every sub-agent runs on it**, whatever the spawn names; if the harness does not list it, ask the user to change the setting.
- **Check the model the sub-agent reports** when the choice matters, for example when you compare models or cost.
  Try a new name with a short `ttl_ms`.
- **Leave `mode` unset** unless you know the harness.
  A mode that asks for approvals stalls an unattended sub-agent, because nobody answers.
- **Claude Code on `haiku` needs `mode="bypassPermissions"`.** Haiku cannot use the default `auto` mode, so it falls back to one that asks before a tool call.
  Its `report_result` call then waits for an approval and the sub-agent hangs until its deadline.
- **A setting the harness cannot apply fails fast.** If the image has no way to set its model, or its harness has no such setting (`effort` on `pi`, `mode` on `codex`), the spawn fails with that reason once the sub-agent boots, instead of running on the default.

## Failures

`spawn()` raises `InvocationFailed` when the sub-agent fails.
Its `reason` says why — setup failed (a harness config it cannot apply included), deadline exceeded, the sub-agent restarted mid-turn, the provider does not fit.
The sub-agent is already deleted by then, so **print or log the reason**; it is the only diagnosis there is.

## Schema shorthand (`s`)

The server validates the result against JSON Schema.
`s()` expands shorthand; raw JSON Schema passes through unchanged.

```python
"integer"                              # a single integer (also: string, number, boolean, null)
{"pass": "boolean", "note": "string"}  # object, both fields required, no extras
{"score": "number?"}                   # trailing "?" makes a field optional
["string"]                             # array of strings
{"verdict": d.s.enum(["passed", "continue"])}  # enum field
```

## Fan-out and compute

- `d.budget()` returns your compute ceiling and what is reserved now; each `list_images()` entry carries its `size`.
  Spawns past the free room queue and start as room frees, so a wide fan-out runs slower, not dead.
- In a script, run parallel spawns from threads (Python) or `Promise.all` (JS); a wide or long fan-out belongs to the tools.
- **You stay awake while your sub-agents run.** The platform keeps this agent from hibernating while any sub-agent it spawned is still running.

## Things to know

- **A sub-agent is unattended.** Its prompt must let it make its own calls and run end to end.
  It reports through a `report_result` tool the platform injects.
- **Validation is structural, not truth.** The platform checks the shape, never that it's correct.
  Judging correctness is your prompt's job.
- **Never retry a spawn call itself on a network error** without checking: a duplicated spawn is a second sub-agent.
