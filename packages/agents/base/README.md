# Debian agent base

The shared base of the agent images built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of a Dockerfile, on Debian (trixie-slim): the claude-code, codex, pi-agent and bob harnesses, each an agent directory beside this one with an `image.toml`. They bake in every tool (node 26, python 3.12, docker, k3s and kubectl included), with no lazy installs or tool shims and no `oc` or `gws`. docker and k3s are not started for the agent; [`AGENTS.md`](rootfs/etc/AGENTS.md) tells it how to start them. Only agent-runtime and driver-sdk are built from the rest of the repo, and the content shared with the Fedora images still built on [platform-base](../../platform-base/) (k-search, the e2e mock) is copied from there. The workload images beside them build `FROM` the claude-code image.

```sh
mise run //packages/agents:oci -- claude-code --load       # → platform-claude-code:latest in docker
mise run //packages/agents:oci -- codex --from=REF --load  # another base image
mise run //packages/agents:image -- pi-agent               # routes these agents through the task above
```

CI builds them in `image:ci-build` (the `build-agents` job) and pushes the OCI layout by digest with crane.

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM; a changed image cannot be built on macOS itself yet, and `//packages/agents:image` reuses the registry image while its source is unchanged. The apt step needs root, so the task runs `mise oci build` under `sudo` when it is not root. The OCI layout lands in `~/.cache/platform-agent-oci/out/<agent>`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## How it is put together

Each of these agents is a mise [config environment](https://mise.jdx.dev/configuration/environments.html) named after its directory. The [`oci`](../.mise/tasks/oci) task stages a mise project outside the repo: [`miserc.toml`](miserc.toml) as its `.miserc.toml`, which opts into `env_conf_d`; [`base.toml`](base.toml) as `mise/conf.d/base.toml`, which always loads; and each agent's `image.toml` as `mise/conf.d/harness.<agent>.toml`, which loads only under `-E <agent>`. In the repo the files keep names mise would not load, because every agent directory is a mise config root.

| Piece | What it does |
|---|---|
| [`base.toml`](base.toml) | Shared tools, apt packages, entrypoint, env, and the copies of the shared trees. |
| [`rootfs/`](rootfs/) | The shared files, at their image paths: entrypoint, agent account, instructions, runtime mise settings, the docker and k3s configs. |
| `../<agent>/image.toml` | The agent's tools and env, and the copies of its own tree, which come after the shared ones and replace what they share (harness scripts, runtime manifest). |
| `../<agent>/rootfs/` | The agent's own files at their image paths. |
| [`../.mise/tasks/oci`](../.mise/tasks/oci) | Builds agent-runtime and driver-sdk on the host into `build/`, copies platform-base's shared content there (skills, dam-skills, the shipped-skill manifest, the working-dir seed, the default runtime manifest, dam-run, the experiment SDK), stages the project beside it, links the claude CLI into `tool-bin` for claude-code, then runs `mise lock` for the host platform, `mise install` and `mise -E <agent> oci build` from inside the stage. |

## What Debian and `mise oci` needed

- **Both backends.** In a container the image runs as the agent user (65532), whose account comes from `libnss-extrausers`; everything the build adds is owned by it, which keeps the home, the trust store and the mise data dir writable. A vm Backend machine boots it as root after platform-init has mounted the home and bound the MITM CA, and [`agent-entrypoint`](rootfs/usr/local/bin/agent-entrypoint) copies `agent` into `/etc/passwd` remapped to uid 0 for SSH logins and creates sshd's `/run/sshd`. On both it trusts the CA with `update-ca-certificates` and seeds the home from `/app/working-dir`, which stays the pristine copy the runtime reconciles image skills against.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs under `~/.local/share`: the machine root is an overlay neither can use, and the home is the one guest path on the disk. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **node 26.** From 26.8.2 it bundles npm 11.19.1, so no install needs editing, and it links against `libatomic`, which trixie-slim lacks.
- **Bob from its tarball.** Bob ships as a self-contained npm tarball outside the registry, taken as an `http:` tool. It goes without the optional dependencies `npm install -g` would add (node-pty, `@vscode/ripgrep`, officecli).
- **Locked before install.** The task runs `mise lock` for the host platform first, so an install under `MISE_LOCKED=1` (CI) has URLs and checksums.
- **The base image through mirror.gcr.io.** Docker Hub's Debian image is pulled through Google's mirror, which CI runners pull without Docker Hub's anonymous rate limit.
- **`node_modules` is left out when staging.** pnpm links the pi extension's dev dependencies into its tree, and the image ships the extension's source only.
- **`.miserc.toml` is read from the working directory.** mise does not look for it under `-C`, which would load every harness fragment at once, so the task runs its mise calls from inside the stage.
- **Copy paths are relative to the fragment** as staged, not the project, and a copy cannot target `/`, so each top-level directory is its own copy.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
