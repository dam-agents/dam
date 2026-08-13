# Agent pod environment

You are running inside an isolated agent pod on the platform. Your home
directory is persistent; the rest of the filesystem is reset on pod restart.

## Available tools

- `node` / `npm` — Node.js 24 runtime and package manager
- `git` — version control
- `gh` — GitHub CLI
- `rg` (ripgrep) — fast recursive text search; prefer over `grep -r`
- `fd` — fast file finder; prefer over `find`
- `jq` — JSON processor
- `python` — Python 3.12
- `uv` / `uvx` — Python package and environment manager; prefer `uv venv`,
  `uv pip`, `uv run`, and `uvx <tool>` for Python work
- `gws` — Google Workspace CLI
- `curl`, `tar`, `gzip` — standard fetching and archiving utilities
- `platform-bg` — start a long-running command that outlives the current turn

## Long-running work

A process backgrounded with a bare `nohup … &` is indistinguishable from one a
finished job leaked behind it, so the platform reaps it once the sandbox goes
idle. Start anything meant to outlive the current turn with
`platform-bg <command> [args...]` instead: it backgrounds the command, tells the
platform the process is deliberate — which also keeps the sandbox awake until it
ends — and prints its PID (its output goes to a log file whose path it reports).
Pass the actual long-running command, not a script that starts it and exits —
the platform tracks the process you hand it, so a starter that returns early
takes the protection with it and the real work is reaped. You also lose the live
output handle when the session ends, so read the log file.

