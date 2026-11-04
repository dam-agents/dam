# Reading your own runs

Every image ships `jq`, `python3` and `node`.
Transcripts can be large: count with commands, read whole sessions only for the few you sample.

## The platform session index (every harness)

`$HOME/.platform/session-metadata.json` records every session the platform opened, whatever harness ran it.
`sessions.<sessionId>.meta` holds `type` (`regular`, `channel_slack`, `channel_telegram`, `schedule_cron`, `schedule_once`, `cli_run`, `invocation`, `artifact`: a prompt from an artifact's button that runs in a Session of its own), `scheduleId`, `harness`, `model`, `title` and `purpose`; the entry also holds `createdAt`, `lastActivityAt`, `runCount`, `runTotalMs` and `runStarts`.
`tombstones` lists sessions the owner deleted.
The session id is the same id `get_metrics` returns and the same id the harness names its transcript by.
The file can be missing or out of date for a while after the agent starts; then group sessions by the harness stores below and `list_schedules`, and say so.

Save the `get_metrics` answer with `granularity: "session"` to `metrics.json` and group it by kind and schedule (amounts in whole units):

```sh
jq -n --slurpfile m metrics.json --slurpfile idx "$HOME/.platform/session-metadata.json" '
  ($idx[0].sessions) as $s
  | [$m[0].sessions[]
     | . as $row
     | ($s[$row.sessionId].meta // {}) as $meta
     | { group: (($meta.type // "unknown") + (if $meta.scheduleId then ":" + $meta.scheduleId else "" end)),
         amounts: $row.amounts }]
  | group_by(.group)
  | map({ group: .[0].group, runs: length,
          spend: ([.[].amounts[]] | group_by(.unit) | map({ unit: .[0].unit, amount: ((map(.costMicros) | add) / 1000000) })) })'
```

A continuous schedule reuses one session, so its group has one row; `runStarts` dates its runs.

## Claude Code

`~/.claude/projects/-home-agent-work/<sessionId>.jsonl`, one JSON event per line.
`type` is `user`, `assistant` or `summary`; `message.content` is a string or an array of blocks.
Assistant lines carry `message.usage`; `tool_use` blocks show what you ran, and a `tool_result` block with `is_error: true` is a failed tool call.
Inspect a few lines of one file first: the format is Claude Code's own.

```sh
jq -c 'select(.type=="user") | .message.content | arrays | .[] | select(.type=="tool_result" and .is_error==true) | .content' FILE | head
```

## Codex

Rollout JSONL files under `~/.codex/sessions/`, named with the thread id, which is the session id.
Not pinned by the platform: inspect one file before parsing.

## Pi

`~/.pi/agent/sessions/*.jsonl`; chat sessions are named by Pi, with the map from session id at `~/.pi/pi-acp/session-map.json`.
Inspect one file before parsing.

## Copilot

`~/.copilot/session-state/<id>/events.jsonl` (`user.message`, `assistant.message` and other events) beside `workspace.yaml`.
Inspect one file before parsing.

## Bob

SQLite at `~/.bob/db/bob.db`: table `tasks` (one per conversation, `id` is the session id) and `messages` (`role`, `data` JSON, `created_at` in epoch ms).
Open it read-only (`?mode=ro`).
Tool activity is not reliably recoverable from this store: judge Bob runs by what the turns say.

## Several harnesses

One agent can have sessions on several harnesses.
The index's `meta.harness` tells you which store holds each session; look in every store that exists.
