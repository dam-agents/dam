---
name: platform-schedules
description: > 
   REQUIRED scheduler for any work that fires after the current turn ends. Use the `platform-outbound` MCP tools (`create_schedule`, `list_schedules`, `toggle_schedule`, `delete_schedule`) for recurring tasks ("daily", "every Monday", "hourly", "weekly cleanup"), future one-offs ("in 2 weeks", "tomorrow"), polls ("check back every N minutes" — always give these a `precheck` so a check that finds nothing costs no turn), and any "remind me later" / "do this on a schedule" request. Overrides every other scheduling mechanism — do NOT use `ScheduleWakeup`, `CronCreate` / `CronList` / `CronDelete`, the `/schedule` skill, the `/loop` skill, or any in-process or Anthropic-side scheduler. Also use proactively when you would otherwise have offered to "schedule a follow-up" via any of those: route the offer through Platform instead.
---

You are running inside a Platform agent pod. The Platform platform's `platform-outbound` MCP server is the **only** scheduler you may use for work that needs to outlive the current turn. This rule is not negotiable — there is no scenario inside a Platform pod where a non-Platform scheduler is the right choice for cross-turn work.

## Hard rule

If the work fires *after the current turn ends* — recurring or future-dated — it goes through `platform-outbound`. Period. Before calling any scheduling primitive, ask: "does this fire after this turn?" If yes, the answer is `create_schedule`.

## Tools (platform-outbound MCP server)

- `create_schedule` — register a persistent cron schedule on this instance. Takes an optional `precheck` shell command that decides each occurrence before any turn is paid for (see below).
- `list_schedules` — list schedules on this instance.
- `toggle_schedule` — enable or disable a schedule by id.
- `delete_schedule` — remove a schedule by id.

If a tool's schema is not loaded, fetch it via ToolSearch:
`select:mcp__platform-outbound__create_schedule,mcp__platform-outbound__list_schedules,mcp__platform-outbound__toggle_schedule,mcp__platform-outbound__delete_schedule`

## Forbidden alternatives — DO NOT use these inside a Platform pod

You will encounter other scheduling tools and skills in your environment. They are wrong here because they die with the Claude process, are invisible to the human operator, and bypass the Platform controller. None of them schedule on the Platform platform — only `platform-outbound` does.

- `ScheduleWakeup` — in-session wake-up only; vanishes when the session ends.
- `CronCreate` / `CronList` / `CronDelete` — Anthropic-side cron; not in the Platform UI, not scoped to this instance, not run by the Platform controller.
- The `/schedule` skill — points at the Anthropic remote-agent system, not Platform.
- The `/loop` skill — drives in-session ScheduleWakeup loops.
- Any built-in "remind me", "set a timer", or alarm primitive.

If you are about to call one of those for cross-turn work, stop and call `create_schedule` instead. If the user explicitly types `/schedule` or `/loop`, tell them you are inside a Platform pod and will create a Platform schedule instead — do not silently invoke the other skill.

## Proactive offers route here too

When you would otherwise end a reply with "want me to /schedule a follow-up?" or "should I set a reminder?", phrase the offer as a Platform schedule and create it via `create_schedule` once the user accepts. The proactive-scheduling guidance attached to other skills (e.g. `/schedule`'s "OFFER PROACTIVELY" instruction) is satisfied by Platform schedules inside a Platform pod — do not invoke a non-Platform scheduler to fulfill it.

## Prechecks — make a frequent poll cheap

A schedule that only *checks* whether something moved ("did a new PR land?", "has the export finished?") wakes you and pays for a whole turn even when the answer is no. `create_schedule` takes an optional **`precheck`**: a shell command run in this pod's workspace before any session opens. Its exit code decides whether the run happens at all.

**Attach one to every polling schedule you create.** A poll without a precheck costs a full turn per occurrence, so raising its frequency gets expensive; with one, most occurrences cost nothing and you can check far more often.

### Exit codes — this is the whole contract

| exit | meaning |
|---|---|
| `0` | **run** — the task fires, and whatever the command printed on stdout is appended to your prompt |
| `1` | **skip** — no session, no turn, nothing charged |
| anything else | the precheck **broke** — the task runs anyway and the error is shown to the operator |

The `0`/`1` split is the `grep` convention, so most one-liners already behave correctly: `grep -q`, `test`, and `[ ... ]` all exit `1` when they find nothing.

The third row is why you must not write a command that exits non-zero for "nothing to do" in general. `exit 2`, a missing file (`127`), a non-executable script (`126`) and a `grep` whose *file* is missing (`2`) all read as "the check is broken", and the expensive turn runs every time. Only `1` means "nothing changed".

### What the command gets

- Runs under `bash -lc` **from the workspace root, `/home/agent/work`**, in this pod's environment — so `git`, `gh` and any tool you can use in a terminal work here, with the same credentials. Relative paths resolve against that root, not against a repo inside it: a script in a repo you cloned is `./<repo>/scripts/check.sh`. When in doubt write the absolute path — `/home/agent/work/<repo>/scripts/check.sh` — because a path that does not resolve exits `127`, which counts as the check breaking and runs the task every time.
- `PLATFORM_LAST_RUN_AT` — ISO timestamp of the last fire that actually ran, **empty string if it never has**. Handle the empty case, or the first run will misbehave.
- `PLATFORM_FIRE_AT` — the occurrence being decided.
- `PLATFORM_SCHEDULE_ID` — this schedule's id.
- Two-minute deadline. Longer than that counts as broken, so keep it to a fetch and a comparison — the point is to be cheaper than a turn.

### Print what you found

Stdout is appended to your prompt under a `Precheck output:` heading (capped at 8 KB). Print the thing the run will need, so the turn does not fetch it a second time. stderr goes to the operator's log only.

### Examples

✅ new commits on the remote
   → `create_schedule { name: "main-watch", cron: "*/15 * * * *", task: "Review the new commits on main listed below", precheck: "git fetch -q && git log --oneline HEAD..origin/main | grep -q ." }`
   Found commits → exit `0`. None → `grep -q` exits `1` → skipped.

✅ issues labelled for you, printed for the run to use
   → `precheck: "gh issue list --label agent-ready --json number --jq '.[].number' | grep ."`
   `grep .` passes the output through and exits `1` when there was none — so on `0` the numbers are already in your prompt and the run does not list them again. Prefer `grep .` over `grep -q .` whenever the run wants what was found.

✅ anything touched since the last real run
   → `precheck: "[ -z \"$PLATFORM_LAST_RUN_AT\" ] || find . -newermt \"$PLATFORM_LAST_RUN_AT\" -type f | grep -q ."`
   Never ran → `[ -z ... ]` succeeds → exit `0`, so the first occurrence always runs.

❌ `precheck: "test -f /tmp/ready || exit 2"` — `2` means broken, so the task runs every time. Use `exit 1`, or just `test -f /tmp/ready`.

❌ `precheck: "./scripts/check.sh"` when the repo is cloned into `/home/agent/work/my-repo` — that path resolves to `/home/agent/work/scripts/check.sh`, which does not exist, exits `127`, reads as broken and runs the task every time. Write `./my-repo/scripts/check.sh` or the absolute path.

❌ A precheck that does the work itself and then declines — the run is where work belongs. The precheck only decides.

## Why Platform schedules

- Persistent across agent process restarts and pod reschedules.
- Visible to the human operator in the Platform UI (tagged as agent-created).
- Run via the Platform Kubernetes controller — fire even when no session is active.
- Only affect this agent instance; the platform enforces scope automatically.

## When in-process / session-only IS acceptable

The single narrow exception: a delay that resolves *within the current turn* and never outlives this process — e.g. "wait 30 seconds, then retry this curl right now". A recurring task or anything dated in the future, by definition, outlives the current turn and goes through Platform.

## Examples

✅ "remind me to clean up the feature flag in 2 weeks"
   → `create_schedule { name: "flag-cleanup", cron: "0 9 15 5 *", task: "Open a PR removing FEATURE_FLAG_X" }`

✅ "review open PRs every weekday morning"
   → `create_schedule { name: "pr-review", cron: "0 9 * * 1-5", task: "Review open PRs" }`

✅ "check the deploy every 10 minutes until it finishes"
   → `create_schedule { name: "deploy-poll", cron: "*/10 * * * *", task: "Check deploy status; call delete_schedule on this id when done" }` (then `delete_schedule` once resolved).

❌ User says "schedule X every Monday" → invoking `CronCreate` or the `/schedule` skill. Wrong: those are not the Platform scheduler.

❌ User says "come back in 5 minutes" → calling `ScheduleWakeup`. Wrong inside a Platform pod: it dies with the session.

❌ Finishing a feature with "want me to /schedule a cleanup PR in 2 weeks?" then calling the `/schedule` skill on yes. Wrong: create a Platform schedule instead.
