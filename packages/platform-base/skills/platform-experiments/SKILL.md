---
name: platform-experiments
description: >
   REQUIRED reporting for any iterate-and-score loop. The moment your work is "produce a candidate, score it, keep iterating" — tuning a prompt against a metric, evolving or mutating a program, searching a config / hyperparameter space, optimizing against any number, or running any optimization / search / evolutionary loop — report EVERY scored candidate by calling the `record_run` tool on the `platform-outbound` MCP server. Write the candidate to a file in your workspace, then call `record_run` with the iteration's numeric score and the path to that file. Do it once per scored iteration, as you go, not batched at the end. This is how an experiment's run ledger fills; a candidate you never record is invisible to the platform. Applies whenever the work has that shape even if your task prompt never mentions experiments, runs, scores, arms, or this tool.
---

You are running inside a Platform agent pod, and your work is an iterate-and-score loop. Every scored candidate that loop produces belongs in your experiment's run ledger. You put it there with `record_run` — once per iteration, as the score lands.

## Does this apply to you?

Ask one question: **am I iterating over candidates and scoring them?**

Yes if you are doing any of:

- tuning a prompt and measuring it against an eval set
- evolving, mutating, or breeding programs / configs and ranking them by a metric
- searching a space — grid, random, evolutionary, bandit, anything
- optimizing some artifact against a number and looping to improve it
- repeatedly producing a result and judging how good it is

If yes, then each scored iteration **is** a Run, and you report it. The shape of the work is the trigger — not whether anyone told you this is an "experiment".

## The contract — two steps per iteration

1. **Write the candidate to a file in your workspace.** Whatever the iteration produced — a prompt, a program, a config, a diff, a JSON blob — one file per candidate (e.g. `candidate.json`, `prompt-r3.txt`, `gen7-best.py`).
2. **Call `record_run`** with the iteration's `score` (a single number, higher is better) and `candidate` (the path to that file — absolute under `$HOME` or relative to your workspace).

The platform reads that file, stores its bytes, and appends a Run to the ledger attributed to you. You hand over a path; the platform pulls the file. There is no shared artifacts directory, nothing to upload, and no place to "drop" candidates — keep them in your own workspace and pass the path. Cap is 10 MiB per candidate.

## Rules

- **Report every scored iteration, the moment it has a score.** Incrementally, not batched at the end. The ledger should fill while your loop runs.
- **One call = one Run = one candidate + its score.**
- **Score is a single number, higher-is-better.** If your metric is naturally lower-is-better (loss, error, latency, cost), negate it so higher wins.
- **Attribution is automatic.** The platform resolves which experiment arm you are from your verified agent identity. There is no experiment-id argument and you never pass one.
- **Do not delete the candidate file before the call returns** — the platform reads it during the call.

## Tool

`record_run` on the `platform-outbound` MCP server. If its schema is not loaded, fetch it via ToolSearch:

`select:mcp__platform-outbound__record_run`

## When it does nothing

`record_run` only works while this agent is an arm of a *running* experiment. If you are not in one, the call returns an error saying no arm is active. That is expected — outside an experiment there is nothing to report to, and it does not mean you did anything wrong. Run your loop as normal.

## Examples

✅ Prompt tuning — round 3's system prompt scores 0.82 on the eval set:
   write it to `prompt-r3.txt`, then `record_run { score: 0.82, candidate: "prompt-r3.txt" }`.

✅ Program evolution — a mutated solver scores 1450 on the benchmark:
   write it to `gen7-best.py`, then `record_run { score: 1450, candidate: "gen7-best.py" }`.

✅ Minimizing a loss — best validation loss this iteration is 0.13:
   `record_run { score: -0.13, candidate: "checkpoint.json" }` (negated so higher wins).

❌ Looping 50 times, then one `record_run` at the end with only the best — the other 49 are lost. Report each as it happens.

❌ Passing the score but skipping the file, or trying to upload bytes — `record_run` takes a path; write the candidate to disk first.

❌ Hunting for a shared "artifacts" folder to put candidates in — there isn't one. Keep them in your workspace and pass the path.

## Why

- The run ledger is how an experiment compares its arms. A candidate you never `record_run` did not happen as far as the platform is concerned.
- Reporting incrementally lets the human watch progress and compare arms *while they run*, instead of seeing nothing until the loop finishes.
- The harness owns the loop and the scoring; the platform only captures what you report. It never inspects your candidate or interprets your score.
