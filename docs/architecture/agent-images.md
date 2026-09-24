# Agent images

Last verified: 2026-09-24

The container images an agent runs in: one per harness (Claude Code, Codex, pi, Bob), the workloads layered over Claude Code's, and the e2e mock. Every one carries the agent-runtime, its harness, and every tool the agent is given, baked in: nothing installs lazily and there are no tool shims. Sources live in [`packages/agents/`](../../packages/agents/), one directory per image, named after its component.

## One base, one environment per image

All images but k-search are built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) on Debian (trixie-slim), with no Dockerfile. The shared base ([`packages/agents/base/`](../../packages/agents/base/)) declares the common tools, system packages, entrypoint and environment, and holds what every image ships: the shared skills and their [Shipped-Skill Manifest](agent-skills.md), the working-dir seed, the default runtime manifest, and dam-run.

- **A harness image** is a mise config environment over the base: its own tools and env, and a `rootfs/` of its files at their image paths. Its files replace the base's where both ship one (harness scripts, runtime manifest).
- **A workload** is an environment over Claude Code's. Its Python package is a baked tool with its own venv, which the image names in an environment variable; scripts run the workload through that venv, not the image's `python`.
- **k-search** is the one Dockerfile image, `FROM` the Claude Code image, because it clones and patches two repositories at build time.
- **The e2e mock** is an environment too, kept beside its source in [`packages/e2e/agents/mock/`](../../packages/e2e/agents/mock/).

Only the agent-runtime, driver-sdk and the experiment SDK come from the rest of the repo; the build compiles them into each image.

## Building

One task, [`//packages/agents:image`](../../packages/agents/.mise/tasks/image), builds any agent image as `platform-<agent>:latest` in docker, or reuses it from the registry while its source is unchanged (the same source hash [`image:resolve`](../../.mise/tasks/image/resolve) keys CI on). CI calls it from [`image:ci-build`](../../.mise/tasks/image/ci-build) and pushes each architecture's OCI layout by digest with crane.

- **Linux of the image's architecture only.** `mise oci` packages the build host's own tool installs and runs its `apt-get` into a side rootfs, under root. On macOS the task builds in the cluster tasks' Lima VM from a copy of the working tree and loads the result into the host's docker. Loading an OCI layout needs Docker's containerd image store (the default from Docker 29).
- **Staged outside the repo.** Every agent directory is a mise config root in the repo, so the task stages a separate mise project where the base always loads and each agent's environment loads only when selected.
- **Pins live in the environment files.** There are no build-arg overrides.

## Ownership and the two Backends

The image is built root-owned, and the agent (uid 65532) is then given only the paths it must write: its home, the mise data dir and system config, the `/app` directory and the trust store. Everything else stays root's, including the shipped skills, the working-dir seed and Claude Code's managed settings, so an agent cannot rewrite what the platform ships.

- **Container Backend:** the image runs as the agent user, whose account comes from a static extra-users database.
- **vm Backend:** the machine boots the image as root after platform-init has mounted the home and bound the MITM CA ([vm-runner](vm-runner.md)). The entrypoint maps `agent` to uid 0 for SSH logins and prepares sshd.

On both, the [entrypoint](../../packages/agents/base/rootfs/usr/local/bin/agent-entrypoint) trusts the gateway's MITM CA in the system bundle and seeds a new home from the working-dir seed. The seed stays pristine: the runtime reconciles image skills against it ([agent-skills](agent-skills.md)).

## What the agent gets

- Every tool's install directory is on `PATH`, and login shells restore it, because Debian's profile resets `PATH`.
- docker and k3s are baked in but not started. The image's instructions tell the agent how to start them, and both keep their data under the home, the one path on a machine's disk that either can use.
- An agent's own `mise use -g`, `npm i -g` and `pip install` work. A tool pin persisted in the home from an older image does not shadow the baked tool, because the baked install directories come first on `PATH`.
