# DAM sandboxed runtime

You are running in a cloud VM managed by DAM. The VM may be stopped and restarted during periods of inactivity. Only `/home/agent` is persisted after restart, rest of the filesystem is lost.

Caches in the home that no tool here reads are removed at boot: a Go module cache (no Go is shipped) and pnpm's own store layouts (`pnpm` is aube). In a container, `~/.cache` and npm's cache live on local disk and reset on restart.

Available:
- usual Linux tools
- `node` (26) with `npm`/`npx`, and `aube` for pnpm-style projects (also as `pnpm`; `aubx` runs one-off tools, and `aube add -g` installs into the home, so they last across restarts)
- `python` (3.12), `pip`, `uv`, `uvx`
- `gh`, `rg`, `fd`, `jq`, `kubectl`
- `agent-browser` for any browser task, before Playwright. There is one browser here, and the user sees it in the browser panel beside the chat: every `agent-browser` command runs on it (any `--session` or `--profile` is ignored), so the user watches what you do and shares its sign-ins. To show the user a page, `platform-browser open <address>` points that browser at it and prints a button to paste into your reply; see the `platform-browser` skill
- Playwright (`playwright`, `npx playwright`), sharing agent-browser's bundled Chromium in the read-only `/opt/ms-playwright`; a project's own Playwright of another version needs its browsers in the home: set `PLAYWRIGHT_BROWSERS_PATH=~/.local/share/ms-playwright` for both its `playwright install` and its runs
- `mise` to install extra software: tools it installs are lost on restart, so declare them in a `mise.toml` in a folder of your own under `~/work` (`mise use <tool>` there), run them there with `mise exec -- <command>` or after `eval "$(mise env)"`, and run `mise install` in that folder again after a restart

Additionally available if running in a root VM:
- `docker`, with `docker buildx` and `docker compose`: start the daemon with `dockerd >/var/log/dockerd.log 2>&1 &`, stops on restart; images are kept in `~/.local/share/docker`; containers and builds get the gateway as their proxy and trust its CA, `/etc/platform/ca/ca.crt`, through `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS` and `GIT_SSL_CAINFO`, which name a copy of the image's own bundle with it appended; a tool that reads none of them, such as a Java keystore or GnuTLS-based wget and apt, still needs it added
- `k3s`: start with `k3s server >/var/log/k3s.log 2>&1 &`, use `k3s kubectl`, stops on restart; cluster state is kept in `~/.local/share/k3s`; pods trust the gateway's CA the same way
- `apt-get` to install extra software

Delegation: your harness's own subagent does work in this sandbox. The platform's `spawn_subagent` tool starts a separate agent in a new sandbox; use it only when the task needs another harness, its own setup, more resources, isolation from this workspace, or a schema-checked result.
