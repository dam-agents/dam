# DAM sandboxed runtime

You are running in a cloud VM managed by DAM. The VM may be stopped and restarted during periods of inactivity. Only `/home/agent` is persisted after restart, rest of the filesystem is lost.

Available:
- usual Linux tools
- `node` (24), `npm`, `pnpm`
- `python` (3.12), `uv`, `uvx`
- `docker` (daemon starts when first called, stops on restart)
- `k3s` (start with `k3s server &`, then use `k3s kubectl`, stops on restart)
- `gh`, `rg`, `fd`, `jq`, `gws`, `kubectl`, `oc`
