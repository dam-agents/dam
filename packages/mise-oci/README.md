# mise oci images (experimental)

Agent images built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of Dockerfiles, on Debian instead of Fedora: one image per harness (Claude Code, Codex, Pi, Bob). It is a trial: nothing in the chart, CI or `cluster:*` uses them. They started from platform-base and the agent packages and diverge from them on purpose. They own a copy of every file they ship, run node 26, bake in every tool (docker, k3s and kubectl included), drop the lazy installs, tool shims, `oc`, `gws` and pip removal, and run only as vm Backend machines, which boot them as root. docker and k3s are started by hand, as [`AGENTS.md`](image/rootfs/etc/AGENTS.md) tells the agent. Only agent-runtime and driver-sdk come from the rest of the repo, built from source.

```sh
mise run //packages/mise-oci:image -- claude --load            # → platform-claude-debian:latest in docker
mise run //packages/mise-oci:image -- codex --from=REF --load  # another base (e.g. a Docker Hub mirror)
```

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM (Ubuntu). The OCI layout lands in `~/.cache/platform-mise-oci/out/<harness>`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## How it is put together

A harness is a mise [config environment](https://mise.jdx.dev/configuration/environments.html). [`image/.miserc.toml`](image/.miserc.toml) opts into `env_conf_d`, so under `-E <harness>` mise loads [`base.toml`](image/mise/conf.d/base.toml) and that harness's `harness.<harness>.toml` fragment, and nothing of the others.

| Piece | What it does |
|---|---|
| [`image/mise/conf.d/base.toml`](image/mise/conf.d/base.toml) | Shared tools, apt packages, entrypoint, env, and the copies of the shared trees. |
| `image/mise/conf.d/harness.<harness>.toml` | The harness's tools and env, and the copies of its own tree, which come after the shared ones and replace what they share (harness scripts, runtime manifest). |
| [`image/rootfs/`](image/rootfs/) | The shared files at their image paths: entrypoint, skills, working-dir seed, manifests, runtime mise settings, the docker and k3s configs. |
| `image/harness/<harness>/` | Each harness's own files at their image paths. |
| [`.mise/tasks/image`](.mise/tasks/image) | Builds agent-runtime and driver-sdk on the host into `build/`, stages `image/` beside it outside the repo, links the claude CLI into `tool-bin` for Claude, and runs `mise -E <harness> oci build` from inside the stage. |

The four images share their base layers by digest: 18 layers and 454 MB of 522–722 MB each, so all four take about 1.2 GB in a registry.

## What Debian and `mise oci` needed

- **vm Backend only.** The machine boots the image as root after platform-init has mounted the home from the disk and bound the MITM CA, so everything in the image is root-owned and there is no agent uid. [`agent-entrypoint`](image/rootfs/usr/local/bin/agent-entrypoint) adds `agent` to `/etc/passwd` as root under that name for SSH logins, creates sshd's `/run/sshd`, trusts the CA with `update-ca-certificates`, and seeds the home from `/app/working-dir`, which stays the pristine copy the runtime reconciles image skills against.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs under `~/.local/share`: the machine root is an overlay neither can use, and the home is the one guest path on the disk. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **node 26.** From 26.8.2 it bundles npm 11.19.1, so no install needs editing, and it links against `libatomic`, which trixie-slim lacks.
- **Bob from its tarball.** Bob ships as a self-contained npm tarball outside the registry, taken as an `http:` tool. It goes without the optional dependencies `npm install -g` would add (node-pty, `@vscode/ripgrep`, officecli).
- **`.miserc.toml` is read from the working directory.** mise does not look for it under `-C`, which would load every harness fragment at once, so the task runs its mise calls from inside the stage.
- **Copy paths are relative to the fragment**, not the project, and a copy cannot target `/`, so each top-level directory is its own copy.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
