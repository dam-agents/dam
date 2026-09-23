# mise oci images (experimental)

An agent image built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of a Dockerfile, on Debian instead of Fedora. It is a trial: nothing in the chart, CI or `cluster:*` uses it. The image it builds is the Claude Code harness with everything platform-base ships, and with every tool preinstalled (docker, k3s, kubectl and gws included). It drops platform-base's lazy installs, tool shims, `oc` and pip removal: docker and k3s are started by hand, as its [`AGENTS.md`](debian-base/AGENTS.md) tells the agent.

```sh
mise run //packages/mise-oci:image -- --load            # → platform-claude-code-debian:latest in docker
mise run //packages/mise-oci:image -- --from=REF --load # another base (e.g. a Docker Hub mirror)
```

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM (Ubuntu). The OCI layout lands in `~/.cache/platform-mise-oci/out/<image>`.

## How it is put together

| Piece | Where | What it does |
|---|---|---|
| Base config | [`debian-base/image.toml`](debian-base/image.toml) | Tools, apt packages, entrypoint, env. Staged as the build's `mise.toml`. |
| Harness config | [`claude-code/image.toml`](claude-code/image.toml) | The harness tools and env. Staged as `mise.claude-code.toml`, merged with `-E claude-code`. |
| Stage scripts | [`debian-base/stage.sh`](debian-base/stage.sh), [`claude-code/stage.sh`](claude-code/stage.sh) | Put the Dockerfiles' `COPY` payload into one rootfs tree, which becomes one `--copy` layer per top-level directory. |
| Debian adapters | [`debian-base/rootfs/`](debian-base/rootfs/) | What the Fedora-shaped shared scripts need on Debian (below). |

The build host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach). The image task builds agent-runtime on the host with the repo's own toolchain (platform-base's builder stage), stages everything outside the repo so the repo's root mise config does not leak tools into the image, and runs `mise oci build --owner 65532:0`.

## What Debian and `mise oci` needed

- **One owner for every added file.** `--owner` stamps every file the tool, copy and config layers add, and the parent directories on their paths (`/usr`, `/etc`). apt's layer keeps root. So the agent owns what platform-base chowns to it, and also the scripts and tools that platform-base leaves root-owned.
- **The agent account lives in extrausers.** `[bootstrap.users]`, `[bootstrap.files]` and `[bootstrap.directories]` are ignored by `mise oci build`, and a layer can only replace `/etc/passwd` whole, which would drop the users apt's maintainer scripts created. `libnss-extrausers` plus an `nsswitch.conf` puts `agent` in `/var/lib/extrausers` instead.
- **A second entrypoint around the shared one.** [`debian-entrypoint`](debian-base/rootfs/usr/local/bin/debian-entrypoint) runs before [`agent-entrypoint`](../platform-base/entrypoint.sh). On a root machine it copies `agent` into `/etc/passwd`, because extrausers will not serve the uid 0 entry the shared script remaps it to, and it creates sshd's `/run/sshd`. It runs after it too, to sync the system CA bundle when the trust store came from the vm Backend's cache.
- **`update-ca-trust` on Debian.** The shared entrypoint trusts the platform MITM CA through Fedora's p11-kit `trust`, then `update-ca-trust`. [`update-ca-trust`](debian-base/rootfs/usr/sbin/update-ca-trust) does it with `update-ca-certificates`. `trust` is missing, so that first attempt logs a `not found` on every boot with a MITM CA.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs on `/workspace`, the vm Backend's disk, because the machine root is an overlay neither can use. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **A hook instead of a RUN step.** The npm self-upgrade is a `postinstall` hook on node. It runs on the host, against the install that becomes the node layer. mise's layer cache does not see a hook change, so the task keys its install and cache directories by the two configs.
- **gws from its release.** mise's npm backend skips install scripts, and `@googleworkspace/cli` fetches its binary in one, so the npm install only fetches gws on first use.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
