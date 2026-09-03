# Harness session stores — how to read each one

`scripts/locate-history.sh` tells you which store this pod has. This file tells
you how to read it. Every image ships `jq`, `python3`, and `node`; use whichever
the recipe names. Transcripts can be large — sample whole sessions, do not grep
everything.

## The platform session index (every harness)

`$HOME/.platform/session-metadata.json` — the platform's own record of every
session, independent of the harness store. Shape:

```json
{
  "sessions": {
    "<sessionId>": {
      "meta": { "type": "schedule_cron", "scheduleId": "…", "threadTs": "…", "experimentId": "…" },
      "createdAt": "2026-08-01T09:00:00.000Z",
      "lastActivityAt": "2026-08-01T09:04:12.000Z"
    }
  },
  "tombstones": ["<sessionId>"]
}
```

All `meta` fields are optional. `tombstones` lists sessions the owner deleted —
skip them. Classify: `type == "schedule_cron"` is a
scheduled run, `threadTs` present is channel-driven, `experimentId` present is
an experiment run, otherwise on-demand. Count the window like:

```sh
jq -r --arg since "$(date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-7d +%Y-%m-%d)" '
  (.tombstones // []) as $gone
  | .sessions | to_entries[]
  | select(.value.createdAt >= $since and ([.key] | inside($gone) | not))
  | [.key, (.value.meta.type // "on-demand"), .value.createdAt] | @tsv
' "$HOME/.platform/session-metadata.json"
```

Join these session ids against the harness store below to pick transcripts to
read. Sessions may predate the index or exist only in one of the two — count
from the index, sample from the store, and say which one a number came from.

## claude-code family — verified

Images: claude-code, nous, gepa, openevolve, shinkaevolve, skydiscover.

Store: `~/.claude/projects/<project-dir>/<sessionId>.jsonl`, one file per
session, one JSON event per line. Useful fields: `type` (`user`, `assistant`,
`summary`), `message` (`role`, `content` as a string or an array of blocks),
`timestamp` (ISO).

List sessions in the window:

```sh
find "$HOME/.claude/projects" -name '*.jsonl' -type f -mtime -7
```

First real user message of a session (skip harness wrappers — lines whose text
starts with `<command-name>`, `<local-command-stdout>`, or `<system-`, and
anything marked `isMeta`):

```sh
jq -r 'select(.type == "user") | .message.content |
  if type == "string" then . else (map(select(.type == "text")) | .[0].text // empty) end' \
  "$FILE" | grep -v '^<' | head -3
```

Read a whole session: the file top-to-bottom is the conversation; assistant
lines with tool blocks show what the agent did.

## bob — verified

Store: SQLite at `~/.bob/db/bob.db`, tables `tasks` (one per conversation) and
`messages`. `tasks` carries `id`, `title`, `first_message`, `directory`,
`updated_at` (epoch milliseconds). `messages` carries `role`, `data` (JSON:
`{"role": …, "content": string | [{"text": …}]}`), `created_at` (epoch
milliseconds). Platform session id ↔ bob task id map:
`~/.bob/platform-shim-sessions.json`.

List conversations in the window:

```sh
python3 - <<'EOF'
import sqlite3, datetime
db = sqlite3.connect("file:" + __import__("os").path.expanduser("~/.bob/db/bob.db") + "?mode=ro", uri=True)
cutoff = (datetime.datetime.now() - datetime.timedelta(days=7)).timestamp() * 1000
for row in db.execute("SELECT id, title, first_message, updated_at FROM tasks WHERE updated_at >= ? ORDER BY updated_at", (cutoff,)):
    print(row)
EOF
```

Read one conversation: `SELECT role, data, created_at FROM messages WHERE
task_id = ? ORDER BY created_at`. Caveat: the rows hold the text turns; tool
activity is not reliably recoverable from this store, so describe bob work from
what the turns say, not from tool traces.

## pi — sessions verified upstream, format not pinned

Store: `~/.pi/agent/sessions/*.jsonl`. Terminal sessions are named by the
platform session id; chat sessions are named by pi itself, with the ACP-id
mapping at `~/.pi/pi-acp/session-map.json`. The JSONL shape is pi's own —
inspect the first lines of one file (`head -3`) to learn it before parsing.

Memory is often the richer source on pi: `~/.pi/agent/memory/` holds
`MEMORY.md`, `USER.md`, `IDENTITY.md`, and `daily/YYYY-MM-DD.md` activity logs
that already summarize what happened per day.

## codex — not verified, probe first

Nothing in the platform pins where codex persists sessions. Upstream codex
keeps rollout JSONL files under `~/.codex/sessions/`; the locator probes for
any `*.jsonl` under `~/.codex`. If it finds files, inspect one before parsing.
If it finds none, say "codex transcripts were not locatable on this pod" in the
document's source note and work from the platform index, workspace, and memory.

## No store at all

Some workloads keep no conversational history (nothing under any path above
and no platform index). Then there is nothing to summarize: report that and
stop, as SKILL.md instructs.
