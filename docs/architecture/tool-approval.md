# Tool approval

Last verified: 2026-11-12

## Overview

**Tool approval** is how a harness decides whether a tool call runs without a person: it asks, it lets a classifier decide, or it runs every tool unasked.
The platform names three of them, `ask`, `auto` and `bypass`, and each harness keeps its own in one of its settings, which the runtime writes and the pickers read.
This page owns who may choose a tool approval, where the choice is kept, and which sessions it reaches.
How a setting reaches a live harness is [harness configuration](harness-config.md#session-settings); what a refused call means on a channel turn is [channel turns](channel-turns.md).

## What each harness offers

A harness's catalog says which setting holds its approval and which of the three it offers.

- **Claude Code** keeps it in its permission mode: `ask` is Accept edits, where edits never prompt, `auto` is Auto mode, and `bypass` is Bypass permissions.
- **Bob** keeps it in its approvals option, a flag its process reads at start, and has no `bypass`.
- **Copilot** keeps it in its mode, and Autopilot, its one choice, is `auto`.
- **Pi and Codex** offer none: they run every tool unasked.

A Plan mode is not a tool approval, and no picker offers one.
A choice that waits for a person is marked `needsApproval` in the catalog.

## The session's pick

A chat session picks its own tool approval in the picker beside its model, below the chat input.
The picker is shown only where the session's harness offers two choices or more, so a session on Pi, Codex or Copilot shows none.
The pick configures that session alone and starts with its next turn; it is saved in no default.
No Session Pair, profile, channel, schedule or Config panel holds a tool approval, and one stored in a pair from before this rule is never read.

## The agent's tool approval

An agent may hold one tool approval of its own, for all its sessions.
It is a value of the agent, not part of a pair, so it follows no profile and no model.
`dam agent update --tool-approval ask|auto|bypass` saves it and `default` removes it; `dam agent get` shows it.
The api-server refuses a value none of the agent's harnesses takes from the agent; before the agent's first `hello` its harnesses are unknown, and any value is saved.

The value travels to the runtime beside the session defaults, in the same event, so the runtime applies it without asking the api-server.
A session that picked no tool approval starts on the agent's, and a session's own pick always wins.
A session of any kind takes it: a chat, a `dam run`, a channel turn and a schedule fire.
A change reaches a live session with its next prompt.

The runtime leaves the agent's value out, and the session starts as it would with none, in three cases:

- the choice waits for a person and nobody is there, as on a channel turn or a schedule fire, so an agent on `ask` still answers in Slack;
- the session's model cannot use the choice, as Haiku 4.5 cannot use Auto mode;
- the harness keeps approval outside its mode (Bob), since the runtime sets the agent's value as the session's start mode.

The start mode the agent's value gives is the runtime's own, like a mode it derives from the catalog: the harness's answer to it is not saved as a pick of the session, so the session keeps following the agent's value.
A terminal session is not covered: its harness shows and switches the mode on its own screen.

With no agent value and no pick, a session starts on the mode the runtime derives from the catalog: Auto mode on Claude Code, or the first mode the session's model allows where it cannot use Auto ([harness configuration](harness-config.md#session-settings)).
The chat's picker shows the approval the session really starts on: its own pick, else the agent's, else Auto mode.
