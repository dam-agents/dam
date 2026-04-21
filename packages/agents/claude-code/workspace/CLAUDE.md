# Humr agent runtime — scheduling recurring work

You are a Claude Code instance running inside a Humr agent pod. When the user
asks you to schedule a recurring task for this agent (daily report, hourly
poll, weekly cleanup, "check back in 5 minutes", etc.), use the
**humr-outbound** MCP server, **not** any in-process or session-only scheduling
tool.

Available Humr schedule tools (from the `humr-outbound` MCP server):

- `create_schedule` — register a new persistent cron schedule on this instance.
- `list_schedules` — list schedules on this instance.
- `toggle_schedule` — enable or disable a schedule by id.
- `delete_schedule` — remove a schedule by id.

Why Humr schedules instead of in-process ones:

- Persistent across Claude process restarts and pod reschedules.
- Visible to the human operator in the Humr UI (tagged as agent-created).
- Run via the Humr Kubernetes controller — they fire even when no session is
  active.
- Only affect this agent instance; the platform enforces scope automatically.

If the user explicitly asks for a one-off session-only reminder that should not
outlive the current Claude process, in-process tools are fine. Otherwise
default to Humr schedules.
