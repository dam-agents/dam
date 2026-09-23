# mise oci images (experimental)

The Claude Code agent image built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of a Dockerfile, on Debian instead of Fedora. It is a trial: nothing in the chart, CI or `cluster:*` uses it. It started from the platform-base and claude-code images and diverges from them on purpose: it owns a copy of every file it ships, runs node 26, bakes in every tool (docker, k3s, kubectl and gws included), and drops the lazy installs, tool shims, `oc` and pip removal. docker and k3s are started by hand, as its [`AGENTS.md`](rootfs/etc/AGENTS.md) tells the agent. Only agent-runtime and driver-sdk come from the rest of the repo, built from source.

```sh
mise run //packages/mise-oci:image -- --load            # → platform-claude-code-debian:latest in docker
mise run //packages/mise-oci:image -- --from=REF --load # another base (e.g. a Docker Hub mirror)
```

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM (Ubuntu). The OCI layout lands in `~/.cache/platform-mise-oci/out/claude-code`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## How it is put together

| Piece | What it does |
|---|---|
| [`image.toml`](image.toml) | Tools, apt packages, entrypoint, env. Staged as the build's `mise.toml`. |
| [`rootfs/`](rootfs/) | Every file the image ships, at its image path: entrypoint, harness scripts and libs, skills, working-dir seed, manifests, the extrausers account, `nsswitch.conf`, runtime mise settings, the docker and k3s configs. |
| [`.mise/tasks/image`](.mise/tasks/image) | Builds agent-runtime and driver-sdk on the host, stages them with `rootfs/`, links the claude CLI into `tool-bin`, and runs `mise oci build --owner 65532:0` with one `--copy` layer per top-level directory. |

The build runs outside the repo, so the repo's root mise config does not leak tools into the image.

## What Debian and `mise oci` needed

- **One owner for every added file.** `--owner` stamps every file the tool, copy and config layers add, and the parent directories on their paths (`/usr`, `/etc`). apt's layer keeps root. So the agent owns what platform-base chowns to it, and also the scripts and tools that platform-base leaves root-owned.
- **The agent account lives in extrausers.** `[bootstrap.users]`, `[bootstrap.files]` and `[bootstrap.directories]` are ignored by `mise oci build`, and a layer can only replace `/etc/passwd` whole, which would drop the users apt's maintainer scripts created. `libnss-extrausers` plus an `nsswitch.conf` puts `agent` in `/var/lib/extrausers` instead. extrausers will not serve uid 0, so on a root machine the entrypoint copies `agent` into `/etc/passwd` before remapping it.
- **Its own entrypoint.** [`agent-entrypoint`](rootfs/usr/local/bin/agent-entrypoint) trusts the MITM CA with `update-ca-certificates` (no p11-kit, no vm Backend trust cache), and drops the workspace mise-pin cleanup: baked tools' bin directories come first on PATH, so a stale pin cannot shadow them.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs on `/workspace`, the vm Backend's disk, because the machine root is an overlay neither can use. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **node 26.** From 26.8.2 it bundles npm 11.19.1, so no install needs editing, and it links against `libatomic`, which trixie-slim lacks.
- **gws from its release.** mise's npm backend skips install scripts, and `@googleworkspace/cli` fetches its binary in one, so the npm install only fetches gws on first use.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
