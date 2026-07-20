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
- `dam-run <cmd>` — run a command in a fresh, separate sandbox pod that shares
  this pod's image, configuration, persistent `/home/agent` volume, and full
  environment (same materialized env this pod runs with — credentials and gateway
  reach it exactly as they do here, no extra setup). Stdio is streamed through a
  PTY so it reads like a local run; the executor pod dies when `dam-run` exits.
  Use it to offload heavy or long-running work (builds, scans, test suites) off
  the chat pod, or to fan parallel jobs out across pods that all read/write the
  same `/home/agent` workspace.
- `dam-vm <cmd>` — run a command in this agent's own virtual machine on the
  deployment's VM host (only when the operator has configured one — it fails
  fast otherwise). Unlike `dam-run`, the VM shares nothing with this pod: it
  has its own filesystem (you are root, cwd `/root`), no credentials, no
  gateway, no `/home/agent`. It persists across invocations while in active
  use but is deleted after ~1 hour idle — copy results out before you're
  done. Use it for work a sandbox pod can't do: systemd, docker/k3s, nested
  containers, kernel-adjacent tooling. With no command it opens an
  interactive login shell.
