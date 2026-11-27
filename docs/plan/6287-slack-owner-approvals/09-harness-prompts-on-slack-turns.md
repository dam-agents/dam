# 09 — Harness prompts on Slack turns (dropped)

**Depends on:** 05-card-lifecycle
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Status

Dropped after its data check, and folded into [10](./10-harness-prompts-in-unwatched-runs.md).
A harness prompt on a Slack turn stays refused at once, as before this feature, and the Slack relay (`requestPermission` in `core/acp-client.ts`) does not change.

## Why

- **The data check.** Production, 2026-11-20 to 2026-11-26:
  - Slack-turn permission refusals (`approval.unattended_deny`): one, a Claude Code Bash call on 2026-11-20, and none in the six days after it;
  - harness prompts that expired in runs nobody watched: 133, all from Bob, about 19 a day.
- **The local check.** Bob on Auto still asks before a write into `~/.bob`.
  On a Slack turn, the relay refused it at once, and the agent said that the write was blocked.
  In a schedule, the prompt waited 10 minutes with no card, the runtime then answered it with an error, and Bob wrote the same file with a shell command.
- **The cost.** This slice held prompts inside the relay that every Slack turn uses, with two new ways to end the wait (Stop and "Don't wait"), new thread text and new security log events, for a case that happened once in a week.

## What moved to 10

- The prompt row: the tool's title, its input, the expiry and one button per harness option.
- The map from a button to the approvals service verdict, which gives the harness the option the owner clicked.
- The prompt shapes: Claude Code (`claude-agent-acp`) puts the canonical tool name in a top-level `name`; Bob sends no `name` and no `_meta`, only `toolCallId`, `title` (the display text with the path or the command), `kind`, `rawInput` and `content`, and its protected calls offer only allow once and reject.
  The repository has no CUGA harness.

A later issue can add the Slack-turn hold and reuse both.
