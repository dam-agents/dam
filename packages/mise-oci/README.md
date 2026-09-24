# mise oci images

The default agent images for the four harnesses — claude-code, codex, pi-agent and bob — built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of Dockerfiles, on Debian (trixie-slim). They bake in every tool (node 26, python 3.12, docker, k3s and kubectl included), with no lazy installs or tool shims and no `oc` or `gws`. docker and k3s are not started for the agent; [`AGENTS.md`](image/rootfs/etc/AGENTS.md) tells it how to start them. Only agent-runtime and driver-sdk are built from the rest of the repo, and the content shared with the Fedora images still built on [platform-base](../platform-base/) (k-search, the e2e mock) is copied from there. The workload images in [`packages/agents/`](../agents/) build `FROM` the claude-code image.

```sh
mise run //packages/mise-oci:image -- claude-code --load        # → platform-claude-code:latest in docker
mise run //packages/mise-oci:image -- codex --from=REF --load   # another base image
mise run //packages/agents:image -- pi-agent                    # routes the four harnesses through the task above
```

CI builds them in `image:ci-build` (the `build-agents` job) and pushes the OCI layout by digest with crane.

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM; a changed harness image cannot be built on macOS itself yet, and `//packages/agents:image` reuses the registry image while its source is unchanged. The apt step needs root, so the task runs `mise oci build` under `sudo` when it is not root. The OCI layout lands in `~/.cache/platform-mise-oci/out/<component>`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## How it is put together

A harness is a mise [config environment](https://mise.jdx.dev/configuration/environments.html) named by its component. [`image/.miserc.toml`](image/.miserc.toml) opts into `env_conf_d`, so under `-E <component>` mise loads [`base.toml`](image/mise/conf.d/base.toml) and that harness's `harness.<component>.toml` fragment, and nothing of the others.

| Piece | What it does |
|---|---|
| [`image/mise/conf.d/base.toml`](image/mise/conf.d/base.toml) | Shared tools, apt packages, entrypoint, env, and the copies of the shared trees. |
| `image/mise/conf.d/harness.<component>.toml` | The harness's tools and env, and the copies of its own tree, which come after the shared ones and replace what they share (harness scripts, runtime manifest). |
| [`image/rootfs/`](image/rootfs/) | The shared files this package owns, at their image paths: entrypoint, agent account, instructions, runtime mise settings, the docker and k3s configs. |
| [`image/harness/<component>/`](image/harness/) | Each harness's own files at their image paths. |
| [`.mise/tasks/image`](.mise/tasks/image) | Builds agent-runtime and driver-sdk on the host into `build/`, copies platform-base's shared content there (skills, dam-skills, the shipped-skill manifest, the working-dir seed, the default runtime manifest, dam-run, the experiment SDK), stages `image/` beside it outside the repo, links the claude CLI into `tool-bin` for claude-code, then runs `mise lock` for the host platform, `mise install` and `mise -E <component> oci build` from inside the stage. |

## What Debian and `mise oci` needed

- **Both backends.** In a container the image runs as the agent user (65532), whose account comes from `libnss-extrausers`; everything the build adds is owned by it, which keeps the home, the trust store and the mise data dir writable. A vm Backend machine boots it as root after platform-init has mounted the home and bound the MITM CA, and [`agent-entrypoint`](image/rootfs/usr/local/bin/agent-entrypoint) copies `agent` into `/etc/passwd` remapped to uid 0 for SSH logins and creates sshd's `/run/sshd`. On both it trusts the CA with `update-ca-certificates` and seeds the home from `/app/working-dir`, which stays the pristine copy the runtime reconciles image skills against.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs under `~/.local/share`: the machine root is an overlay neither can use, and the home is the one guest path on the disk. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **node 26.** From 26.8.2 it bundles npm 11.19.1, so no install needs editing, and it links against `libatomic`, which trixie-slim lacks.
- **Bob from its tarball.** Bob ships as a self-contained npm tarball outside the registry, taken as an `http:` tool. It goes without the optional dependencies `npm install -g` would add (node-pty, `@vscode/ripgrep`, officecli).
- **Locked before install.** The task runs `mise lock` for the host platform first, so an install under `MISE_LOCKED=1` (CI) has URLs and checksums.
- **The base image through mirror.gcr.io.** Docker Hub's Debian image is pulled through Google's mirror, which CI runners pull without Docker Hub's anonymous rate limit.
- **`node_modules` is left out when staging.** pnpm links the pi extension's dev dependencies into its tree, and the image ships the extension's source only.
- **`.miserc.toml` is read from the working directory.** mise does not look for it under `-C`, which would load every harness fragment at once, so the task runs its mise calls from inside the stage.
- **Copy paths are relative to the fragment**, not the project, and a copy cannot target `/`, so each top-level directory is its own copy.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
