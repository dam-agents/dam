---
name: humr-schedules
description: Schedule recurring or future agent tasks via the Humr platform (daily reports, hourly polls, weekly cleanups, "check back in 5 minutes"). Use whenever the user asks to schedule a task that should outlive the current session — call the humr-outbound MCP tools instead of any in-process / session-only scheduler.
---

You are running inside a Humr agent pod. When the user asks you to schedule a
recurring task for this agent, use the **humr-outbound** MCP server, **not**
any in-process or session-only scheduling tool.

Available Humr schedule tools (from the `humr-outbound` MCP server):

- `create_schedule` — register a new persistent cron schedule on this instance.
- `list_schedules` — list schedules on this instance.
- `toggle_schedule` — enable or disable a schedule by id.
- `delete_schedule` — remove a schedule by id.

Why Humr schedules instead of in-process ones:

- Persistent across agent process restarts and pod reschedules.
- Visible to the human operator in the Humr UI (tagged as agent-created).
- Run via the Humr Kubernetes controller — they fire even when no session is
  active.
- Only affect this agent instance; the platform enforces scope automatically.

If the user explicitly asks for a one-off session-only reminder that should not
outlive the current process, in-process tools are fine. Otherwise default to
Humr schedules.
