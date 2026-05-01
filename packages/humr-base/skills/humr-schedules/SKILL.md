---
name: humr-schedules
description: REQUIRED scheduler for any work that fires after the current turn ends. Use the `humr-outbound` MCP tools (`create_schedule`, `list_schedules`, `toggle_schedule`, `delete_schedule`) for recurring tasks ("daily", "every Monday", "hourly", "weekly cleanup"), future one-offs ("in 2 weeks", "tomorrow"), polls ("check back every N minutes"), and any "remind me later" / "do this on a schedule" request. Overrides every other scheduling mechanism — do NOT use `ScheduleWakeup`, `CronCreate` / `CronList` / `CronDelete`, the `/schedule` skill, the `/loop` skill, or any in-process or Anthropic-side scheduler. Also use proactively when you would otherwise have offered to "schedule a follow-up" via any of those: route the offer through Humr instead.
---

You are running inside a Humr agent pod. The Humr platform's `humr-outbound` MCP server is the **only** scheduler you may use for work that needs to outlive the current turn. This rule is not negotiable — there is no scenario inside a Humr pod where a non-Humr scheduler is the right choice for cross-turn work.

## Hard rule

If the work fires *after the current turn ends* — recurring or future-dated — it goes through `humr-outbound`. Period. Before calling any scheduling primitive, ask: "does this fire after this turn?" If yes, the answer is `create_schedule`.

## Tools (humr-outbound MCP server)

- `create_schedule` — register a persistent cron schedule on this instance.
- `list_schedules` — list schedules on this instance.
- `toggle_schedule` — enable or disable a schedule by id.
- `delete_schedule` — remove a schedule by id.

If a tool's schema is not loaded, fetch it via ToolSearch:
`select:mcp__humr-outbound__create_schedule,mcp__humr-outbound__list_schedules,mcp__humr-outbound__toggle_schedule,mcp__humr-outbound__delete_schedule`

## Forbidden alternatives — DO NOT use these inside a Humr pod

You will encounter other scheduling tools and skills in your environment. They are wrong here because they die with the Claude process, are invisible to the human operator, and bypass the Humr controller. None of them schedule on the Humr platform — only `humr-outbound` does.

- `ScheduleWakeup` — in-session wake-up only; vanishes when the session ends.
- `CronCreate` / `CronList` / `CronDelete` — Anthropic-side cron; not in the Humr UI, not scoped to this instance, not run by the Humr controller.
- The `/schedule` skill — points at the Anthropic remote-agent system, not Humr.
- The `/loop` skill — drives in-session ScheduleWakeup loops.
- Any built-in "remind me", "set a timer", or alarm primitive.

If you are about to call one of those for cross-turn work, stop and call `create_schedule` instead. If the user explicitly types `/schedule` or `/loop`, tell them you are inside a Humr pod and will create a Humr schedule instead — do not silently invoke the other skill.

## Proactive offers route here too

When you would otherwise end a reply with "want me to /schedule a follow-up?" or "should I set a reminder?", phrase the offer as a Humr schedule and create it via `create_schedule` once the user accepts. The proactive-scheduling guidance attached to other skills (e.g. `/schedule`'s "OFFER PROACTIVELY" instruction) is satisfied by Humr schedules inside a Humr pod — do not invoke a non-Humr scheduler to fulfill it.

## Why Humr schedules

- Persistent across agent process restarts and pod reschedules.
- Visible to the human operator in the Humr UI (tagged as agent-created).
- Run via the Humr Kubernetes controller — fire even when no session is active.
- Only affect this agent instance; the platform enforces scope automatically.

## When in-process / session-only IS acceptable

The single narrow exception: a delay that resolves *within the current turn* and never outlives this process — e.g. "wait 30 seconds, then retry this curl right now". A recurring task or anything dated in the future, by definition, outlives the current turn and goes through Humr.

## Examples

✅ "remind me to clean up the feature flag in 2 weeks"
   → `create_schedule { name: "flag-cleanup", cron: "0 9 15 5 *", task: "Open a PR removing FEATURE_FLAG_X" }`

✅ "review open PRs every weekday morning"
   → `create_schedule { name: "pr-review", cron: "0 9 * * 1-5", task: "Review open PRs" }`

✅ "check the deploy every 10 minutes until it finishes"
   → `create_schedule { name: "deploy-poll", cron: "*/10 * * * *", task: "Check deploy status; call delete_schedule on this id when done" }` (then `delete_schedule` once resolved).

❌ User says "schedule X every Monday" → invoking `CronCreate` or the `/schedule` skill. Wrong: those are not the Humr scheduler.

❌ User says "come back in 5 minutes" → calling `ScheduleWakeup`. Wrong inside a Humr pod: it dies with the session.

❌ Finishing a feature with "want me to /schedule a cleanup PR in 2 weeks?" then calling the `/schedule` skill on yes. Wrong: create a Humr schedule instead.
