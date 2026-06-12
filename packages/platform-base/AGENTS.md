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
- `uv` / `uvx` — Python package and environment manager; use `uv venv`,
  `uv pip`, `uv run`, and `uvx <tool>` for Python work (no system `pip`/`python`)
- `gws` — Google Workspace CLI
- `curl`, `tar`, `gzip` — standard fetching and archiving utilities
