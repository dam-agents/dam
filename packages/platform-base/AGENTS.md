# DAM sandboxed runtime

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
  `uv pip`, `uv run`, and `uvx <tool>` for Python work. `pip` and
  `python -m pip` forward to `uv pip`; pip-only subcommands (`download`,
  `config`, `cache`, `hash`) are unavailable.
- `gws` — Google Workspace CLI
- `pnpm` — Node package manager for workspace projects
- `curl`, `tar`, `gzip` — standard fetching and archiving utilities

## Installed on first use

Not in the image. The first call installs the tool, then it behaves normally.
An install does not survive a restart; call the tool again.

- `kubectl`, `oc` — Kubernetes and OpenShift clients
- `docker` — container engine. Just run it; the daemon starts on the first call.
- `k3s` — single-node Kubernetes. Start it with `k3s server &`, then use
  `k3s kubectl`. VM sandboxes only; in a container sandbox it refuses to run.
