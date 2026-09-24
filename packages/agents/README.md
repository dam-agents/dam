# Agent images

The claude-code, codex, pi-agent and bob images, and the e2e mock, are built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) instead of a Dockerfile, on Debian (trixie-slim), over the shared base in [`base/`](base/). They bake in every tool (node 26, python 3.12, docker, k3s and kubectl included), with no lazy installs or tool shims and no `oc` or `gws`. docker and k3s are not started for the agent; [`AGENTS.md`](base/rootfs/etc/AGENTS.md) tells it how to start them. What every image shares (the skills and their shipped-skill manifest, the working-dir seed, the default runtime manifest, dam-run) lives in `base/rootfs/`; only agent-runtime, driver-sdk and the experiment SDK are built or copied from the rest of the repo. The workload images, k-search among them, build `FROM` the claude-code image.

```sh
mise run //packages/agents:image -- claude-code          # → platform-claude-code:latest in docker, reused while unchanged
mise run //packages/agents:image -- --build codex        # always build
mise run //packages/agents:image -- mock                 # the e2e mock, from packages/e2e/agents/mock
mise run //packages/agents:image -- nous                 # a workload: claude-code first, then docker build
mise run //packages/agents:image -- --dry-run            # what every agent would build, and how
```

CI builds them in `image:ci-build` (the `build-agents` and `build-mock` jobs, and the e2e job on a PR) and pushes the OCI layout by digest with crane. Loading a layout into docker needs Docker's containerd image store, the default from Docker 29.

The build host must be Linux on the image's architecture, with `apt-get`: `mise oci` packages the host's own tool installs and runs the host's apt-get into a side rootfs. On macOS, run it in the lima VM; a changed image cannot be built on macOS itself yet, and `//packages/agents:image` reuses the registry image while its source is unchanged. The apt step needs root, so the task runs `mise oci build` under `sudo` when it is not root. The OCI layout lands in `~/.cache/platform-agent-oci/out/<agent>`. The host's own mise settings pass through (for example `MISE_GITHUB_ATTESTATIONS=false` where the GitHub API is out of reach).

## Layout

One directory per agent image, named after its component, which is also its `image:resolve` component and, for a mise-built agent, its config environment.

| Directory | Built by | What it holds |
|---|---|---|
| [`base/`](base/) | — | The shared Debian base: [`base.toml`](base/base.toml) (tools, apt packages, entrypoint, env), [`miserc.toml`](base/miserc.toml), [`own-layout.py`](base/own-layout.py), and [`rootfs/`](base/rootfs/) (entrypoint, agent account, instructions, runtime mise settings, the docker and k3s configs, the shared skills and runtime manifest). |
| `claude-code/`, `codex/`, `pi-agent/`, `bob/` | `mise oci` | `image.toml`, the agent's config environment (its tools, env and copies of its tree), and `rootfs/`, its files at their image paths. |
| `nous/`, `openevolve/`, `shinkaevolve/`, `gepa/`, `skydiscover/`, `k-search/` | Dockerfile | Workloads, `FROM` the claude-code image. k-search replaces its harness and runtime manifest. |
| [`../e2e/agents/mock/`](../e2e/agents/mock/) | `mise oci` | The e2e mock's `image.toml` and `rootfs/`, beside its source; the task bundles `mock-agent.js` into it. |

For an `image.toml` agent the [`image`](.mise/tasks/image) task stages a mise project outside the repo that mirrors this directory: `base/` and every agent with an `image.toml` keep their directories, and the files mise loads by name go where it looks for them. `base/miserc.toml` becomes `.miserc.toml`, which opts into `env_conf_d`. `base/base.toml` becomes `mise/conf.d/base.toml`, which always loads. Each `image.toml` becomes `mise/conf.d/harness.<agent>.toml`, which loads only under `-E <agent>`, and its copies come after the shared ones and replace what they share (harness scripts, runtime manifest). In the repo the files keep names mise would not load, because every agent directory is a mise config root. The task also builds agent-runtime and driver-sdk on the host into `build/`, copies the experiment SDK there, and runs `mise install` and `mise -E <agent> oci build` from inside the stage, with CI's `MISE_LOCKED` unset: the staged project has no lockfile.

## What Debian and `mise oci` needed

- **Both backends.** In a container the image runs as the agent user (65532), whose account comes from `libnss-extrausers`, and owns the home, the trust store, the mise data dir, `/etc/mise` and the `/app` directory; everything else, the shipped skills and `/etc/claude-code/managed-settings.json` included, is root's. A vm Backend machine boots it as root after platform-init has mounted the home and bound the MITM CA, and [`agent-entrypoint`](base/rootfs/usr/local/bin/agent-entrypoint) copies `agent` into `/etc/passwd` remapped to uid 0 for SSH logins and creates sshd's `/run/sshd`. On both it trusts the CA with `update-ca-certificates` and seeds the home from `/app/working-dir`, which stays the pristine copy the runtime reconciles image skills against.
- **Static daemon configs instead of shims.** `/etc/docker/daemon.json` and `/etc/rancher/k3s/config.yaml` put both data dirs under `~/.local/share`: the machine root is an overlay neither can use, and the home is the one guest path on the disk. Docker is its static bundle (containerd 2.x) as a mise tool, not trixie's `docker.io`.
- **node 26.** From 26.8.2 it bundles npm 11.19.1, so no install needs editing, and it links against `libatomic`, which trixie-slim lacks.
- **Bob from its tarball.** Bob ships as a self-contained npm tarball outside the registry, taken as an `http:` tool. It goes without the optional dependencies `npm install -g` would add (node-pty, `@vscode/ripgrep`, officecli).
- **The base image through mirror.gcr.io.** Docker Hub's Debian image is pulled through Google's mirror, which CI runners pull without Docker Hub's anonymous rate limit.
- **`node_modules` is left out when staging.** pnpm links the pi extension's dev dependencies into its tree, and the image ships the extension's source only.
- **`.miserc.toml` is read from the working directory.** mise does not look for it under `-C`, which would load every harness fragment at once, so the task runs its mise calls from inside the stage.
- **Copy paths are relative to the fragment** as staged (`mise/conf.d/`), not the project, and a copy cannot target `/`, so each top-level directory is its own copy.
- **Ownership set after the build.** `mise oci build --owner` stamps one owner on every layer it generates, with modes reduced to 644 and 755, so the build runs root-owned and [`own-layout.py`](base/own-layout.py) hands the agent its paths in the finished layout.
- **Runtime mise settings in `conf.d`.** `mise oci` writes `/etc/mise/config.toml` with the baked `[tools]` only.
