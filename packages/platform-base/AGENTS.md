# DAM sandboxed runtime

You are running in a cloud VM managed by DAM. The VM may be stopped and restarted during periods of inactivity. Only `/home/agent` is persisted after restart, rest of the filesystem is lost.

Available:
- usual Linux tools
- `node` (24), `npm`, `pnpm`
- `python` (3.12), `uv`, `uvx`
- `gh`, `rg`, `fd`, `jq`, `gws`, `kubectl`, `oc`
- `mise` to install extra software

Additionally available if running in a root VM:
- `k3s`: start with `k3s server &`, use `k3s kubectl`, stops on restart; cluster state is kept in `~/.local/share/k3s`
- `docker`: daemon starts when first called, stops on restart; images are kept in `~/.local/share/docker` and `~/.local/share/containerd`
- `dnf` to install extra software
