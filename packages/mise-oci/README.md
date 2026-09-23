# mise oci images (experimental)

The Claude Code agent image built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of a Dockerfile, on Debian instead of Fedora. It is a trial: nothing in the chart, CI or `cluster:*` uses it. It ships what the platform-base and claude-code images ship, with every tool preinstalled (docker, k3s, kubectl and gws included), and drops platform-base's lazy installs, tool shims, `oc` and pip removal. docker and k3s are started by hand, as its [`AGENTS.md`](rootfs/etc/AGENTS.md) tells the agent.

```sh
mise run //packages/mise-oci:image -- --load            # → platform-claude-code-debian:latest in docker
mise run //packages/mise-oci:image -- --from=REF --load # another base (e.g. a Docker Hub mirror)
```

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM (Ubuntu). The OCI layout lands in `~/.cache/platform-mise-oci/out/claude-code`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## How it is put together

| Piece | What it does |
|---|---|
| [`image.toml`](image.toml) | Tools, apt packages, entrypoint, env. Staged as the build's `mise.toml`. |
| [`rootfs/`](rootfs/) | What Debian needs on top of the shared payload: the extrausers account, `nsswitch.conf`, runtime mise settings, the docker and k3s data dirs, `AGENTS.md`. |
| [`.mise/tasks/image`](.mise/tasks/image) | Builds agent-runtime on the host, stages [`platform-base/rootfs/`](../platform-base/rootfs/), this rootfs and claude-code's files into one tree, and runs `mise oci build --owner 65532:0` with one `--copy` layer per top-level directory. |

The build runs outside the repo, so the repo's root mise config does not leak tools into the image. [`agent-entrypoint`](../platform-base/rootfs/usr/local/bin/agent-entrypoint) is the shared one: it picks its Debian branches by what the image has.

## What Debian and `mise oci` needed

- **One owner for every added file.** `--owner` stamps every file the tool, copy and config layers add, and the parent directories on their paths (`/usr`, `/etc`). apt's layer keeps root. So the agent owns what platform-base chowns to it, and also the scripts and tools that platform-base leaves root-owned.
- **The agent account lives in extrausers.** `[bootstrap.users]`, `[bootstrap.files]` and `[bootstrap.directories]` are ignored by `mise oci build`, and a layer can only replace `/etc/passwd` whole, which would drop the users apt's maintainer scripts created. `libnss-extrausers` plus an `nsswitch.conf` puts `agent` in `/var/lib/extrausers` instead. extrausers will not serve uid 0, so on a root machine the entrypoint copies `agent` into `/etc/passwd` before remapping it.
- **Trust through `update-ca-certificates`.** There is no p11-kit on Debian. The entrypoint writes the MITM CA into `/usr/local/share/ca-certificates` and rebuilds the system bundle, without the vm Backend's trust cache.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs on `/workspace`, the vm Backend's disk, because the machine root is an overlay neither can use. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **A hook instead of a RUN step.** The npm self-upgrade is a `postinstall` hook on node, run on the host against the install that becomes the node layer. mise's layer cache does not see a hook change, so the task keys its install and cache directories by the config.
- **gws from its release.** mise's npm backend skips install scripts, and `@googleworkspace/cli` fetches its binary in one, so the npm install only fetches gws on first use.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
