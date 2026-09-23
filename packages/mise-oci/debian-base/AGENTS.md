# DAM sandboxed runtime

You are running in a cloud VM managed by DAM. The VM may be stopped and restarted during periods of inactivity. Only `/home/agent` is persisted after restart, rest of the filesystem is lost.

Available:
- usual Linux tools
- `node` (24), `npm`, `pnpm`
- `python` (3.12), `pip`, `uv`, `uvx`
- `gh`, `rg`, `fd`, `jq`, `gws`, `kubectl`
- `mise` to install extra software

Additionally available if running in a root VM:
- `docker`: start the daemon with `(umask 022; dockerd >/var/log/dockerd.log 2>&1 &)`, stops on restart
- `k3s`: start with `(umask 022; k3s server >/var/log/k3s.log 2>&1 &)`, use `k3s kubectl`, stops on restart
- `apt-get` to install extra software
