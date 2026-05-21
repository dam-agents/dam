---
name: pause-and-notify
description: Suspend the software-factory heartbeat after repeated failures and tell the user. Adds the `paused` label to the PRD, posts a summary to the connected chat channel (if any), and comments on the stuck ticket with the failure history. Also has a `resume` mode that announces work has resumed.
---

# Pause and notify

Use this skill when the heartbeat has detected it's stuck (see "Stuck detection" in HEARTBEAT.md) or when explicitly resuming from pause. Do **not** call this skill from any other context — it's not a generic notification helper.

## When to invoke

- **`pause`** — `stuckCounters` for the active work unit has crossed a threshold, or the idle safeguard tripped. The user must intervene before the heartbeat does anything else.
- **`resume`** — Step 0a observed the `paused` label removed from the PRD, and `stuckCounters` in `config.json` is non-empty (i.e. a prior turn paused).

## Inputs

Read from `config.json`:

- `github.repo` — `<owner/repo>`.
- `github.prd` — PRD issue number.
- `stuckCounters[<work-unit>]` — failure record for the stuck unit (pause mode only).

The active work unit is the ticket or PR that tripped the threshold, or the literal string `"idle"` when the idle safeguard fired.

## Pause flow

Run these steps in order. Do not skip any.

### 1. Discover channels

Call `mcp__platform-outbound__describe_channel` for each of `slack` and `telegram`. Collect any chats returned. A channel with zero chats counts as not connected.

If no channel has chats, skip the chat-message step entirely — the PRD label + comment are sufficient. Log one line to stderr noting no channel was available.

### 2. Compose the failure summary

A short plaintext block, 4–10 lines. Includes:

- The active work unit (ticket # or PR #), with title.
- The reason: which threshold tripped (e.g. "3 failures of type `push_blocked` on ticket #42").
- The last 3 failure entries from `stuckCounters[<work-unit>].failures`, each on its own line as `<type>: <detail>` (most recent first).
- The instruction: "Remove the `paused` label on PRD #M to resume."

For the `idle` case, the summary is shorter: "No work moved in N heartbeats and no failures recorded. Likely all open tickets are blocked on something I can't resolve. Remove `paused` on PRD #M to resume."

### 3. Post to the chat channel (if available)

For each connected channel (use the channel-specific last-active chat by omitting `chatId`):

```
mcp__platform-outbound__send_channel_message {
  channel: "slack" | "telegram",
  text: <failure summary from step 2>
}
```

If multiple channels are connected, post to all of them.

### 4. Comment on the stuck ticket (or PRD, for `idle`)

For ticket/PR stuck cases:

```sh
gh issue comment <work-unit-number> --repo <owner/repo> --body "<comment>"
```

Comment body:

```
**Heartbeat paused — needs human attention.**

<failure summary from step 2 — same content, formatted as Markdown>

Full failure history (this work unit):

| When | Type | Detail |
|---|---|---|
| <ISO timestamp> | <type> | <detail> |
| ... | ... | ... |

To resume: remove the `paused` label from PRD #<n>. Counters will reset on the next heartbeat.
```

For `idle`: skip the ticket comment (there is no specific ticket) and put the comment on the PRD itself instead.

### 5. Apply the `paused` label to the PRD

```sh
gh issue edit <prd-number> --repo <owner/repo> --add-label paused
```

If the label doesn't exist, create it first with `gh label create paused`.

### 6. Exit

Do not continue the heartbeat after pausing. Step 0a on the next heartbeat will see the `paused` label and short-circuit; resumption is the user's call.

## Resume flow

Entered in either of two ways:

- **Auto-resume** — Step 0a in HEARTBEAT.md observed `paused` was removed from the PRD by the user. The label is already gone before this skill runs.
- **User-initiated resume** — the user explicitly told the agent (in an interactive session) to continue. The `paused` label is still on the PRD; this skill removes it as the first step.

Detect which path applies by reading the PRD's current labels once at the top:

```sh
gh issue view <prd-number> --repo <owner/repo> --json labels --jq '.labels[].name'
```

If `paused` is present → user-initiated path; run step 0 below before the rest. Otherwise → auto-resume path; skip step 0.

### 0. (User-initiated only) Remove the `paused` label

```sh
gh issue edit <prd-number> --repo <owner/repo> --remove-label paused
```

Only do this when the user has explicitly asked to resume. Never clear the label unprompted — it is the user's veto.

### 1. Clear state

In `config.json`:

- `stuckCounters` → `{}`
- `idleHeartbeats` → `0`

### 2. Discover channels

Same as pause step 1.

### 3. Post resume note (if a channel is connected)

```
mcp__platform-outbound__send_channel_message {
  channel: ...,
  text: "Resuming work on PRD #<n> — counters cleared. Picking up at next heartbeat."
}
```

### 4. Comment on the PRD

```sh
gh issue comment <prd-number> --repo <owner/repo> --body "Resumed — \`paused\` label cleared, stuck counters reset."
```

### 5. Return control to HEARTBEAT.md

After resuming, the same heartbeat continues with normal orchestration (do not exit). The agent should proceed to "Orchestrate Work First" in HEARTBEAT.md.

## Notes

- This skill never calls `toggle_schedule` or `delete_schedule`. The heartbeat must keep firing while paused — that's how it learns the user has removed the label. The cost is one `gh issue view` per minute, which is acceptable.
- If both `pause` and `resume` paths would apply in the same turn (shouldn't happen — Step 0a routes deterministically), prefer `pause`: failures recorded this turn take precedence over a label cleared mid-cycle.
- Channel messages may fail (token rotated, channel disconnected). Treat any send error as a soft failure — log to stderr and continue with the label + comment steps. The PRD label is the hard signal.
