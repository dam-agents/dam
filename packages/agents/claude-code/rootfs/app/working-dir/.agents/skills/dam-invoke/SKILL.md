---
name: dam-invoke
description: Invoke agents on DAM — fresh platform agents in their own sandboxes that run one task and return a schema-validated result. Use when asked to invoke, spawn or hand off to a sub-agent or a throwaway agent, run work on another harness or in isolation, fan work out to fresh agents, or run a make/test/eval step and expect a typed result. For one hand-off use the invoke_agent and await_invocations tools; for loops and wide fan-outs write a script with the driver SDK (Python driver_sdk, JS driver-sdk.mjs).
allowed-tools: mcp__platform-outbound__invoke_agent, mcp__platform-outbound__await_invocations, mcp__platform-outbound__list_harnesses, mcp__platform-outbound__list_connections, mcp__platform-outbound__get_budget, Bash(python3 *), Bash(node *), Write
---

# DAM invoke

The platform can **invoke an agent**: start a fresh agent in its own sandbox
that runs one prompt to completion, reports one result, and is then removed.
You (the driver) hand it a prompt plus the result shape you expect, and get the
validated result back. It runs unattended and cannot ask you anything.

## Your harness's subagent or an invoked agent

Prefer your harness's own subagent tool when it can do the job: it runs in this
sandbox, starts in seconds and costs no extra compute. An invoked agent starts a
new sandbox — tens of seconds to minutes before it runs, with compute counted
against the budget — so invoke one only when the task needs one of:

- a different harness;
- its own setup: a repository to clone, an install command, env;
- more CPU, memory or disk than this sandbox, or a microVM for a container
  runtime or a cluster;
- isolation, so the work cannot touch this workspace;
- heavy parallel work beyond what this sandbox can run;
- a result the platform checks against a schema.

## Hand off one task: the tools

1. **Choose what it runs on — do not guess.** Call `list_harnesses` and
   `list_connections` and show the human what is available. If it is not
   obvious which to use, **ask them**. The model needs nothing: the invoked
   agent runs on *your* model provider.
2. **Invoke.** Call `invoke_agent` with `prompt`, `schema` (JSON Schema, e.g.
   `{"type": "integer"}`) and `harness`, plus any setup option from the table
   below. It returns the invocation id at once.
3. **Wait.** Call `await_invocations` with the ids. It returns as soon as one
   finishes, or after about four minutes, with what is done, failed and still
   running; call it again with the running ids. You may also end your turn
   instead: an invocation that finishes while nothing waits on it is delivered
   back into this session as a new turn.

Several independent tasks: call `invoke_agent` once per task, then wait on all
the ids together.

## Orchestration: a script

Use a script when the delegation has logic of its own — loops, a wide fan-out,
scoring one agent's output with another. The options below mean the same in
both: the tools take them as camelCase JSON (`ttlMs`, `env` as `[{name, value}]`).

### The SDK

The same SDK ships in two languages, both dependency-free and self-configuring
from the pod (no URL or token to pass):

- **Python** — `import driver_sdk as d` works in any `python3` on this image.
- **JS** — `import { spawn, listImages, listConnections, s } from "/usr/local/lib/driver-sdk.mjs";`

Write a small script and run it. Examples below are Python; the JS names are the
camelCase equivalents (`listImages`, `ttlMs`, …) and take one options object.

## Before you spawn: choose what it runs on — do not guess

1. Run `d.list_images()` and `d.list_connections()` and show the human what is
   available. If it is not obvious which to use, **ask them**.
2. **What it runs on** — `harness="claude-code"` (or `codex`, `pi`, `bob`; each
   `list_images()` entry names its `harness`). The sub-agent runs on that
   harness's default image and size. `image="<full ref>"` runs a custom image instead, with
   `harness` saying which harness is inside it; prefer `seed` and `install`
   below over building an image.
3. **Model** — the sub-agent runs on *your* model provider; a harness that
   cannot run on it is refused at spawn. It runs the harness's default model
   unless you pick one (see "Choose the model per spawn").
4. **Connections** — pass what the task needs beyond the model (a repository, an
   API). Everything you pass must be one of your own grants. Its network access
   follows your egress rules, so what you can reach, it can reach.

## Quickstart: a sub-agent that returns a single integer

```python
# spawn_demo.py
import driver_sdk as d

answer = d.spawn(
    "Compute 6 * 7 and report the result as a single integer.",
    "integer",               # the result must be one integer
    harness="claude-code",
    label="demo",
)
print("returned:", answer)   # 42
```

```bash
python3 ~/spawn_demo.py
```

`spawn()` blocks until the sub-agent reports a result that passes validation,
then returns it. Progress lines (`[invoke] spawned demo (agent-xxx)`, `… done`)
print to stderr.

## Setting up the sub-agent

A sub-agent is set up the way a starter kit sets up an agent, so it does not
need a custom image for tooling:

```python
result = d.spawn(
    "Run one evaluation cell and report its verdict.",
    {"passed": "boolean", "note": "string?"},
    harness="claude-code",
    connections=[ghe_connection_id],             # clone access, from list_connections()
    seed={"url": "https://github.example/acme/tool", "commit": my_commit},
    install="uv venv && uv pip install ./tool",  # runs in the workspace before the prompt
    env={"MODE": "cell"},
    resources={"cpu": "2", "memory": "4Gi", "storage": "10Gi"},
    ttl_ms=4 * 3600_000,
    label="cell:persona/task",
)
```

| option | meaning |
|---|---|
| `seed` | Repository cloned into the workspace: `url`, optional `ref` or `commit`, `into` (`"work"` default or `"home"`). Pin `commit` to the commit you are running from, so it runs the same code. |
| `install` | Shell command run once in the workspace before the prompt. Must finish within 15 minutes; longer setup belongs in an image. |
| `env` | Environment variables (Python: a dict; JS: `[{ name, value }]`). |
| `resources` | `cpu`, `memory`, `storage` (disk). Omitted values come from the harness's defaults. |
| `backend` | `"vm"` for a microVM, when the work needs a container runtime or a cluster inside. |
| `skills` | External skills to install: `[{"source": <skill source url>, "name": ...}]`. |
| `connections` | Connection ids to grant, a subset of your own. |
| `image` | A custom image to run instead of the harness's default one. |
| `label` | Names the sub-agent in your script's log lines. |
| `ttl_ms` | Deadline, ~1 min..6 h, default ~60 min. See below. |

A **seed or install that fails fails the spawn at once** with the reason (for
example `install failed: …`), so a broken setup costs seconds, not the whole
deadline.

**Pick `ttl_ms` per sub-agent — it is your fast-fail lever.** It is a kill
deadline, not pacing: the sub-agent is removed the moment it lapses, mid-work or
not. A quick compute or gate gets a short one (`10 * 60_000`); a clone + build +
large change gets a long one. Time spent queued for compute counts too.

**Give a heavy sub-agent more memory.** The harness default (often 1Gi) OOM-kills
a clone plus install or build. An OOM-killed sub-agent fails fast with its reason.

## Choose the model per spawn

One harness runs any model its provider offers, so pick the model per spawn: run
one task on two models to compare the results and the cost, or put mechanical
steps on a cheap model and hard ones on a strong one. `model=`, `mode=` and
`config_options=` (JS: `model`, `mode`, `configOptions`) take the values the
agent's Config panel offers. They are written into the sub-agent's harness
config before its first turn.

```python
cheap = d.spawn(prompt, schema, harness="claude-code", model="haiku", mode="bypassPermissions")
strong = d.spawn(prompt, schema, harness="claude-code", model="opus", config_options={"effort": "high"})
```

| harness | `model` | `config_options` |
|---|---|---|
| `claude-code` | `fable`, `opus`, `sonnet`, `haiku`, or `claude/<provider model>` (see below) | `effort`: `low` … `xhigh` (Haiku takes none) |
| `codex` | a name from the provider's model list | `effort`: `minimal` … `xhigh` |
| `pi` | a name from the provider's model list | — (`mode` is its thinking level: `off` … `xhigh`) |
| `bob` | a name from the provider's model list | `approvals`: keep `auto` |

"The provider's model list" is what the Config panel shows for any agent on the
same model connection.

- **The platform does not check the values, and a wrong one may not fail.**
  Claude Code on Anthropic fails the first turn, and the sub-agent hangs until
  its deadline. Pi instead runs the connection's model without an error.
- **On a provider other than Anthropic, Claude Code's names are approximate.**
  `haiku`, `sonnet` and `opus` run the closest model that provider serves, so
  `haiku` becomes Sonnet on a provider with no Haiku. To be exact, name the
  provider's model with a `claude/` prefix, for example
  `model="claude/aws/claude-opus-4-8"`.
- **Check the model the sub-agent reports** when the choice matters, for example
  when you compare models or cost. Try a new name with a short `ttl_ms`.
- **Leave `mode` unset** unless you know the harness. A mode that asks for
  approvals stalls an unattended sub-agent, because nobody answers.
- **Claude Code on `haiku` needs `mode="bypassPermissions"`.** Haiku cannot use
  the default `auto` mode, so it falls back to one that asks before a tool call.
  Its `report_result` call then waits for an approval and the sub-agent hangs
  until its deadline.
- **A setting the harness cannot apply fails fast.** If the image has no way to
  set its model, or its harness has no such setting (`effort` on `pi`, `mode` on
  `codex`), the spawn fails with that reason once the sub-agent boots, instead
  of running on the default.

## Failures

`spawn()` raises `InvocationFailed` when the sub-agent fails. Its `reason` says
why — setup failed (a harness config it cannot apply included), deadline
exceeded, the sub-agent restarted mid-turn, the provider does not fit. The sub-agent is already deleted by then, so **print or
log the reason**; it is the only diagnosis there is. Let it raise to abort, or
catch it to retry or skip that item.

## Schema shorthand (`s`)

The server validates the result against JSON Schema. `s()` expands shorthand;
raw JSON Schema passes through unchanged.

```python
"integer"                              # a single integer (also: string, number, boolean, null)
{"pass": "boolean", "note": "string"}  # object, both fields required, no extras
{"score": "number?"}                   # trailing "?" makes a field optional
["string"]                             # array of strings
{"verdict": d.s.enum(["passed", "continue"])}  # enum field
```

## Fan-out and compute

- `d.budget()` returns your compute ceiling and what is reserved now; each
  `list_images()` entry carries its `size`. Spawns past the free room queue and
  start as room frees, so a wide fan-out runs slower, not dead.
- Run parallel spawns from threads (Python) or `Promise.all` (JS).
- **You stay awake while your sub-agents run.** The platform keeps this agent
  from hibernating while any sub-agent it spawned is still running. Still, run a
  long fan-out script as a background task, not detached with `nohup`, so the
  session can watch it.

## Things to know

- **A sub-agent is unattended.** Its prompt must let it make its own calls and
  run end to end. It reports through a `report_result` tool the platform injects.
- **Validation is structural, not truth.** The platform checks the shape, never
  that it's correct. Judging correctness is your prompt's job.
- **No resumability.** If your script dies mid-run, its in-memory state is lost.
  Write durable output (a file in `~/work`, a git ref) so a rerun is cheap.
- **Never retry a spawn call itself on a network error** without checking: a
  duplicated spawn is a second sub-agent.
