# Agent images

Last verified: 2026-09-25

The container images an agent runs in: one per harness (Claude Code, Codex, pi, Bob), the workloads layered over Claude Code's, and the e2e mock. Every one carries the agent-runtime, its harness, and every tool the agent is given, baked in: nothing installs lazily, and no baked tool runs through a shim. Sources live in [`packages/agents/`](../../packages/agents/), one directory per image, named after its component.

## One base, one environment per image

Every image is built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) on Debian, with no Dockerfile. The shared base ([`packages/agents/base/`](../../packages/agents/base/)) declares the common tools, system packages, entrypoint and environment, and holds what every image ships: the shared skills and their [Shipped-Skill Manifest](agent-skills.md), the working-dir seed, the default runtime manifest, and dam-run.

- **A harness image** is a mise config environment over the base: its own tools and env, and a `rootfs/` of its files at their image paths. Its files replace the base's where both ship one (harness scripts, runtime manifest).
- **A workload** is an environment over Claude Code's. Its Python package is a baked tool with its own venv, linked at a fixed path and named in an environment variable; the entrypoint and login shells put that venv first on `PATH`, so `python` is the workload's.
- **k-search** runs from upstream source trees rather than a package: they are baked tools too, pinned by commit and checksum, patched by a postinstall and linked at a fixed path (`oci_link`).
- **The e2e mock** is an environment too, kept beside its source in [`packages/e2e/agents/mock/`](../../packages/e2e/agents/mock/).

Only the agent-runtime, driver-sdk and the experiment SDK come from the rest of the repo; the build compiles them into each image.

## Building

One task, [`//packages/agents:oci`](../../packages/agents/.mise/tasks/oci), builds any agent image as a tar in the agent's `dist/oci/`, named `platform-<agent>:latest`, or reuses it from the registry while its source is unchanged (the same source hash [`image:resolve`](../../.mise/tasks/image/resolve) keys CI on). CI calls it from [`image:ci-build`](../../.mise/tasks/image/ci-build) and pushes each architecture's OCI layout by digest with crane.

- **Linux of the image's architecture only.** `mise oci` packages the build host's own tool installs and runs its `apt-get` into a side rootfs, under root. On macOS the task builds in the dev cluster's Lima VM, whichever cluster the images go to, from a copy of the working tree, with the host's GitHub token for the VM's mise, and copies the result back. The tar is the OCI layout itself, named by its `io.containerd.image.name` annotation for `k3s ctr images import`, with the `manifest.json` of a `docker save` beside it for crane and `docker load`.
- **Staged outside the repo.** Every agent directory is a mise config root in the repo, so the task stages a separate mise project where the base always loads and each agent's environment loads only when selected.
- **One system-package layer.** `mise oci` installs system packages afresh in every build and takes a base image only from a registry, so the task builds the shared Debian packages once as their own image, again when their list changes and once a day, and serves it to every build from a registry on localhost. The images share that layer's digest, so a node stores it once.
- **Pins live in the environment files and one lockfile.** The lockfile fixes every tool's version and checksum for both Linux architectures, and the npm tools' whole dependency trees, except the workloads' Python packages, which mise cannot lock and their files pin exactly; CI caches the tool installs under it, so they change only with it. k-search's GPU venv is gigabytes the repository's cache cannot hold: the registry keeps its install with both packaged layers instead, keyed by what shapes them, so an unchanged venv is not packaged again. The nightly run installs it afresh, which picks up its unpinned dependencies' releases. There are no build-arg overrides.

## Ownership and the two Backends

The image is built root-owned, and the agent user is then given only the paths it must write: its home, the mise data dir and system config, the runtime's directory and the trust store. Everything else stays root's, including the shipped skills, the working-dir seed and Claude Code's managed settings, so an agent cannot rewrite what the platform ships.

- **Container Backend:** the image runs as the agent user, whose account comes from a static extra-users database.
- **vm Backend:** the machine boots the image as root after platform-init has mounted the home and bound the MITM CA ([vm-runner](vm-runner.md)). The entrypoint maps `agent` to uid 0 for SSH logins and prepares sshd.

On both, the [entrypoint](../../packages/agents/base/rootfs/usr/local/bin/agent-entrypoint) trusts the gateway's MITM CA in the system bundle and seeds a new home from the working-dir seed. On a machine it also points docker's client at the gateway, so containers and builds the agent starts go through it too. The seed stays pristine: the runtime reconciles image skills against it ([agent-skills](agent-skills.md)).

## What the agent gets

- Every tool's install directory is on `PATH`, and login shells restore it, because Debian's profile resets `PATH`.
- agent-browser and Playwright share one baked Chromium. agent-browser runs its headless shell, which calls none of Google's background services, and both trust the gateway's MITM CA through the NSS store the entrypoint fills in the home, since Chromium does not read the system bundle.
- docker and k3s are baked in but not started. The image's instructions tell the agent how to start them, and both keep their data under the home, the one path on a machine's disk that either can use.
- aube stands in for pnpm; npm stays for tools that call it. An agent's own `aube add -g` and `pip install --user` land in the home and last; `mise use -g`, `npm i -g` and a plain `pip install` install into the image and last until the agent restarts. mise reads no config from the home, so a tool pin an older image persisted there is inert.
