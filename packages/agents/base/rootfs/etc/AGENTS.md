# DAM sandboxed runtime

You are running in a cloud VM managed by DAM. The VM may be stopped and restarted during periods of inactivity. Only `/home/agent` is persisted after restart, rest of the filesystem is lost.

Available:
- usual Linux tools
- `node` (26) with `npm`/`npx`, and `aube` for pnpm-style projects (also as `pnpm`; `aubx` runs one-off tools, and `aube add -g` installs into the home, so they last across restarts)
- `python` (3.12), `pip`, `uv`, `uvx`
- `gh`, `rg`, `fd`, `jq`, `kubectl`
- `agent-browser` and Playwright (`playwright`, `npx playwright`), sharing one bundled Chromium in the read-only `/opt/ms-playwright`; a project's own Playwright of another version needs its browsers in the home: set `PLAYWRIGHT_BROWSERS_PATH=~/.local/share/ms-playwright` for both its `playwright install` and its runs
- `mise` to install extra software: tools it installs are lost on restart, so declare them in a `mise.toml` in a folder of your own under `~/work` (`mise use <tool>` there), run them there with `mise exec -- <command>` or after `eval "$(mise env)"`, and run `mise install` in that folder again after a restart

Additionally available if running in a root VM:
- `docker`: start the daemon with `(umask 022; dockerd >/var/log/dockerd.log 2>&1 &)`, stops on restart; images are kept in `~/.local/share/docker`; containers and builds get the gateway as their proxy, but the gateway answers some hosts with its own CA, `/etc/platform/ca/ca.crt`, which a container or build must trust to reach them (mount it, or add it to the image's trust store)
- `k3s`: start with `(umask 022; k3s server >/var/log/k3s.log 2>&1 &)`, use `k3s kubectl`, stops on restart; cluster state is kept in `~/.local/share/k3s`
- `apt-get` to install extra software
