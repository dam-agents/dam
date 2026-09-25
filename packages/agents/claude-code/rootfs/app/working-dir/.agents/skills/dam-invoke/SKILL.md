---
name: dam-invoke
description: Spawn sub-agents (Invocations) on DAM and get back a schema-validated result. Use when asked to spawn a sub-agent or a throwaway agent, fan work out to fresh agents, or run a make/test/eval step in isolation and expect a typed result (a number, a verdict, an object). Provides a driver SDK in Python (driver_sdk) and JS (driver-sdk.mjs) — spawn / list_images / list_connections / budget.
allowed-tools: Bash(python3 *), Bash(node *), Write
---

# DAM invoke

The platform can spawn a **sub-agent** (an *Invocation*): a fresh agent that runs
one prompt to completion, reports one result, and is then deleted. You (the
driver) create it, hand it a prompt plus the result shape you expect, and get
the validated result back. It runs unattended and cannot ask you anything.

Use this to fan work out: a "make" step that produces something, a "test" or
"eval" step that judges it, or any task you want run in isolation with a typed
answer.

## The SDK

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
   harness's template. `image="<full ref>"` runs a custom image instead, with
   `harness` saying which harness is inside it; prefer `seed` and `install`
   below over building an image.
3. **Model** — nothing to pass. The sub-agent runs on *your* model provider.
   A harness that cannot run on it is refused at spawn.
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
| `resources` | `cpu`, `memory`, `storage` (disk). Omitted values come from the harness's template. |
| `backend` | `"vm"` for a microVM, when the work needs a container runtime or a cluster inside. |
| `skills` | External skills to install: `[{"source": <skill source url>, "name": ...}]`. |
| `connections` | Connection ids to grant, a subset of your own. |
| `image` | A custom image to run instead of the harness's template. |
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

## Failures

`spawn()` raises `InvocationFailed` when the sub-agent fails. Its `reason` says
why — setup failed, deadline exceeded, the sub-agent restarted mid-turn, the
provider does not fit. The sub-agent is already deleted by then, so **print or
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
