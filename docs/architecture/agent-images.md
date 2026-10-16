# Agent images

Last verified: 2026-10-16

The images an agent runs in: the **default image**, which the default Template boots, and the workloads and the e2e mock, each the default image under its own files.
Each carries the agent-runtime and every harness.
The default image bakes the **harness tools**, base's and every harness's, in a layer of their own.
A workload bakes only its own Python, whole, and the mock the node it runs on.
Nothing installs lazily, and no tool runs through a shim.
Sources live in [`packages/agents/`](../../packages/agents/): one directory per image, and one per harness (Claude Code, Codex, pi, Bob), which is a source of the default image and no image of its own.

## One base, one image over it

Every image is a Debian system-package base and directory trees packed onto it as layers, with no Dockerfile.
The shared base ([`packages/agents/base/`](../../packages/agents/base/)) declares the common tools, system packages, entrypoint and environment as mise config, and holds what every image ships: the shared skills and their [Shipped-Skill Manifest](agent-skills.md), the working-dir seed, the default runtime manifest, dam-run, and `platform-keep`, which [keeps](agent-processes.md#keeping-work) a long job running and the agent awake.

- **A harness** is mise config over the base — its tools and env — and a `rootfs/` of its files at their image paths.
  The default image carries all four.
- **A workload** is the default image under its own files and env, so a kit image carries every harness and runs the one its kit names.
  Its Python package is installed into a venv and shipped as a whole Python at a fixed path, the interpreter and its standard library copied in, named in an environment variable; the entrypoint and login shells put it first on `PATH`, so `python` is the workload's, whatever Python the node's tools hold.
  **k-search** also ships its upstream source trees, pinned by commit and checksum and patched at install, at fixed paths.
- **The e2e mock**, beside its source in [`packages/e2e/agents/mock/`](../../packages/e2e/agents/mock/), is the default image under its scripted harness and the node binary its agent-runtime runs.

## The default image and the harness tools

The UI labels an Agent's image by its Template's name in its settings, resolving retired template aliases from the catalogue too; the agent card leaves it out, since a session picks its own harness.
An unknown or absent Template falls back to the image reference.

The default image is every harness over the base at once, with their tools.
Each harness's entry points and runtime manifest sit under its name.
The agent-runtime loads every manifest there and runs each harness's drivers, so one contribution kind can have several bindings, each keeping its state per harness.
The harness is chosen per session ([sessions](sessions.md#session-inside-the-pod)); the Agent's own harness, seeded at create and handed to the pod or machine in its environment, is the default for a session that names none.
The tools, the base's and every harness's, are named in the image's system mise config with the lockfile, and its `PATH` names each tool's versioned install directory under mise's system data dir.
The build installs them there with the image's own installer, run in the image's root under chroot with the image's env, so every path an install records is the one the image runs it from, and packs that directory as one root-owned layer, rebuilt only when the tool config or the installer changes.
mise's own data dir stays the image's, writable, so `mise use -g` still installs there.
A node holds the tools as it holds any image: the kubelet's image collection and the [vm image cache](vm-image-cache.md)'s eviction drop the versions no agent runs.

Images before the tools were baked boot on a node directory instead, which the same installer fills while agents may still run them: a DaemonSet on every node an agent or a VM runner may land on runs the current image's installer into it, and then idles.
On the container Backend every agent pod mounts that directory read-only at the system data dir's path, whatever its image: no other image uses the path, and it holds the same versions the baked image does.
On the `vm` Backend each runner mounts it read-only and shares it read-only into every machine whose image's env names `PLATFORM_TOOLS_VOLUME`, which a baked image does not ([vm-runner](vm-runner.md)), DAX-mapped on x86 so a guest reads the node's page cache rather than copying every file a harness start loads into its own memory.
DAX needs a guest kernel with [smol-machines/libkrunfw#31](https://github.com/smol-machines/libkrunfw/pull/31), which the pinned smolvm release ships ([vm-runner-upgrades](vm-runner-upgrades.md)): without it, from Linux 6.15 on, a process that runs a large binary from a DAX mount dies of SIGBUS once another process opens that binary ([smol-machines/smolvm#1741](https://github.com/smol-machines/smolvm/issues/1741)).
A deploy with a new image rolls the DaemonSet on every node at once, which installs the new versions **in place**, beside the old ones: an agent still on an older image keeps the versions it names, and nothing is pruned.
Playwright's browsers sit with the tools, in the image and in the node directory alike, each image naming its own.
An install cut short (the installer killed, a node drained) is redone on the next run rather than taken as done: mise records a version as mid-install only in its cache, so the installer keeps that cache in the node directory too, and it removes any version directory left empty.
On OpenShift, the node configuration in [`etc/openshift-node-config/`](../../etc/openshift-node-config/) has the nodes create the directory with the label confined pods can read.

The node directory is in the boot path of a container agent: one that starts on a node before its installer has finished has no harness until its next start.
A download host that stalls or trickles fails the install in bounded time, after mise's own retries, and the kubelet restarts the installer until it succeeds, each run keeping what the last one installed.
CI's vm lane restores the node directory from a cache that main writes, keyed on the lockfile and the installer, so on a hit the installer reaches no download host.
On a Mac, whose [host runner](vm-host-runner.md) runs outside the cluster, the tools are copied from the k3s node onto a case-sensitive volume of the runner's.

Only the agent-runtime and the two driver SDKs (JavaScript and Python) come from the rest of the repo; the build compiles them into each image.

The build also bundles Claude Code's ACP adapter with its agent SDK, from the locked install, into a few files of the default image.
Loaded from the tools, the adapter is hundreds of ES modules, each a few reads, paid by each adapter start and by the session-history worker's import of it.
The native CLI the adapter runs stays in the tools; the bundle cannot find it beside the SDK, so Claude Code's chat entry point names its path.

## Building

One task, [`//packages/agents:oci`](../../packages/agents/.mise/tasks/oci), builds any agent image as a tar in the agent's `dist/oci/`, named `platform-<agent>:latest`, or reuses it from the registry while its source is unchanged (the same source hash [`image:resolve`](../../.mise/tasks/image/resolve) keys CI on).
CI calls it from [`image:ci-build`](../../.mise/tasks/image/ci-build) and pushes each architecture's OCI layout by digest with crane.

- **Linux of the image's architecture only.** The build installs the tools for the host's architecture, whose paths the image's `PATH` names, and runs `apt-get` into a side rootfs, under root.
  On macOS the task builds in the dev cluster's Lima VM, whichever cluster the images go to, from a copy of the working tree, with the host's GitHub token for the VM's mise, and copies the result back.
  The tar is the OCI layout itself, named by its `io.containerd.image.name` annotation for `k3s ctr images import`, with a `docker save`-style `manifest.json` beside it, by which crane reads the tar.
- **Staged outside the repo.** Every agent directory is a mise config root in the repo, so the task stages a separate mise project where the base always loads and each agent's environment loads only when selected.
- **One system-package layer, then crane.** The shared Debian packages are installed into the repo's pinned Debian base by that base's own `apt-get`, run in its exported root under chroot as a Dockerfile's `RUN` would, and the root becomes one layer, again when the list or the base changes and once a day.
  That layer follows the packages alone: what the install stamps with the build's time (logs, caches, password dates, the mtimes of the paths it touched) is dropped or set to the base's creation time, so a rebuild with no package update keeps its digest.
  Every image is then packed by [`image:pack`](../../.mise/tasks/image/pack), the platform images' own packer: the default image onto that base, each workload and the mock onto the default image, a sorted tree per layer so a digest follows content alone.
  The images share the base's layers, so a node stores them once.
- **Layers by how often they change.** A node pulls only the layers it lacks, and extracting a big one stalls every pod start on it, so the default image stacks Selkies, then mise, then the harness tools, then Claude Code's adapter bundle, then everything else: the agent-runtime, the harnesses' files and the shipped skills, a few megabytes and the only layer a typical deploy changes.
  Selkies' Python bytecode is checked by source hash, since a packed layer's mtimes are zero.
- **Pins live in the environment files and one lockfile.** The lockfile fixes every tool's version and checksum for both Linux architectures, and the npm tools' whole dependency trees, except the workloads' Python packages, which mise cannot lock and their files pin exactly; CI caches the tool installs under it, so they change only with it.
  k-search's GPU venv is gigabytes the repository's cache cannot hold, so each k-search build installs it afresh, which also picks up its unpinned dependencies' releases.
  There are no build-arg overrides.

## Ownership and the two Backends

The image is root's, but for the paths the agent must write, which each layer is packed with already owned by the agent: its home, the mise data dir and system config, a workload's Python, the runtime's directory and the trust store.
Everything else stays root's, including the shipped skills, the working-dir seed and Claude Code's managed settings, so an agent cannot rewrite what the platform ships.
Layers are packed as plain tars: a local cluster imports them as they are, and CI gzips a published image's layers with parallel gzip as it pushes.

- **Container Backend:** the image runs as the agent user, whose account comes from a static extra-users database.
- **vm Backend:** the machine boots the image as root after platform-init has mounted the home and bound the MITM CA, and platform-init stays the entrypoint's parent, so the image's init is not the first process of its PID namespace ([vm-runner](vm-runner.md)).
  The entrypoint maps `agent` to uid 0 for SSH logins, gives uid 0 the agent's home so OpenSSH keeps its keys there ([persistence](persistence.md#per-agent-pvcs)), and prepares sshd.
  The agent-runtime keeps Node's compile cache beside its own code here, since the root outlives a boot; a container's root is new on every start, so writing the cache would only cost it time.
  The cache is the runtime's alone: no harness or command it starts inherits it.

On both, the [entrypoint](../../packages/agents/base/rootfs/usr/local/bin/agent-entrypoint) trusts every CA under `/etc/platform/ca` in the system bundle — the gateway's MITM CA, and the extra CAs the install names for a TLS-inspecting proxy beyond it — and the agent's environment sets `NODE_USE_SYSTEM_CA`, so Node reads that bundle like every other client, seeds a new home from the working-dir seed, and discards the caches on the home that no tool it ships reads ([persistence](persistence.md#per-agent-pvcs) owns the rule).
The environment also points `SSL_CERT_DIR` at `/etc/platform/ca`: Node's system store reads every file in that directory, and the default, `/etc/ssl/certs`, holds a link to each certificate the bundle already has, and reading them one by one delays every node process on a machine before it can exit or make its first TLS call.
OpenSSL-based clients still find every root in the bundle, and Go also reads the platform CAs from the directory itself.
The bundle, and Chromium's store below, record what they were last built from and are rebuilt only when it changes: a machine's root and every home outlive a boot, and `update-ca-certificates` forks several times for each root the distribution ships, which takes seconds on a machine.
The bundle's record also holds the image's distribution roots, since a machine's root outlives a new image too: the digest of them that the image's build writes, since reading every root costs a machine boot about 150 ms.
An image built without the digest has its roots read instead, and an agent that changes the roots in its own root does so with the package manager, whose trigger rebuilds the bundle with the platform CAs in it.
A store no boot has touched yet, on a container's or a new machine root, is the one the image's build made, so the entrypoint adds only the platform CAs to it and hashes only them, with the same result as `update-ca-certificates` but not its pass over every root.
Every other rebuild, a failed add, and any store with an update hook such as Java's keystore run `update-ca-certificates` itself.
Chromium's store is built beside the runtime's start rather than before it, since nothing starts Chromium before the runtime listens.
On a machine it also points docker's client at the gateway, so containers and builds the agent starts go through it too, and puts the share's runtime wrapper in front of docker's and k3s's runc, so they trust the MITM CA as well.
docker's runc is on the read-only harness tools, so the wrapper is linked as `runc` in a directory under `/run` that the entrypoint and login shells put first on `PATH`; k3s's containerd names it in a drop-in.
A container's root is its own image, which trusts only public roots; when the container starts, the wrapper gives it copies of the image's own bundle with the CA appended, at a path of its own mounted read-only, and points the common CA variables there; a variable the image sets to a bundle is pointed at a copy of that file.
The image's own files are never mounted over, so a build that regenerates its trust store still works, nothing lands in a built image, and no Dockerfile changes.
A client that reads only the distribution's own bundle path and no variable — a Java keystore, GnuTLS-based wget and apt — does not see the CA.
The seed stays pristine: the runtime reconciles image skills against it ([agent-skills](agent-skills.md)).
It holds nothing under `work/`: the default image ships every harness's seed, and a [starter kit](starter-kits.md)'s workspace seed refuses a work directory that is not empty, so a harness's own files go in its config directory in the home.

The seed is copied into a home once, when the home is new, because from then on the home is the agent's own state — so nothing the platform must keep current belongs in it.
Platform code a harness loads at runtime, such as Pi's provider extension, ships at an image-owned path and is loaded from there on every start, so a new image reaches existing agents with no migration of their homes.

## What the agent gets

- Every tool's install directory is on `PATH`, and login shells restore it, because Debian's profile resets `PATH`.
- agent-browser and Playwright share one baked Chromium, and both trust the gateway's MITM CA through the NSS store the entrypoint fills in the home, since Chromium does not read the system bundle.
  The image's `AGENT_BROWSER_*` defaults make agent-browser's browser the [browser panel](browser-panel.md)'s: the full Chromium, headed on the virtual display `platform-display` runs (Xvfb, i3, PipeWire and Selkies, which streams it to the panel), with its shared memory out of the container's small `/dev/shm`, which a heavy page would overflow and crash on.
  Selkies is installed into the base image from hash-pinned wheels, and streams only royalty-free codecs ([browser-panel](browser-panel.md)).
- docker and k3s are baked in but not started.
  The image's instructions tell the agent how to start them, and both keep their data under the home, the one path on a machine's disk that either can use.
- aube stands in for pnpm; npm stays for tools that call it.
  An agent's own `aube add -g` and `pip install --user` land in the home and last; `mise use -g`, `npm i -g` and a plain `pip install` install into the image: in a container they last until the agent restarts, on a machine until its root generation, which the base declares, is bumped ([persistence](persistence.md)).
  mise reads no config from the home, so a tool pin an older image persisted there is inert.

## Image updates

An Agent created from a Template is kept on that Template's current image without its owner, so a deploy's new image, and the runtime fixes in it, reach existing Agents.
An Agent created on an image of its own, a [starter kit](starter-kits.md)'s included, carries no Template and is never moved, nor is one whose Template the install no longer has.
A periodic api-server job applies the [template upgrade](agent-lifecycle.md#template-upgrade) a user would, so the harness carries over: each harness once had an image of its own, and the Templates for those retired images resolve to the default Template, so their Agents move to the default image the same way.
It covers both Backends.
A vm machine keeps its root when the new image declares the same root generation as the old one, and otherwise boots on a fresh root, losing what was installed outside HOME ([vm-runner](vm-runner.md)); that loss is accepted.

It never interrupts work.
A hibernated, stopped or over-budget Agent moves at once and takes the image on its next wake.
That wake costs nothing extra for the default image: the harness tools' DaemonSet has already pulled it onto every node, and the [image cache](vm-image-cache.md) preloads and pins the harness images the install ships, which an older image no longer is.
A Template on an image the cache does not preload is fetched on its first wake, as its old image would be on a node that lacks it.
A running Agent waits for the [idle checker](agent-lifecycle.md#hibernate) to hibernate it.
An always-on Agent never hibernates, so it is restarted onto the new image once the idle checker's own signals agree it is idle: no open connection, no Invocation pin, no activity for an hour, and its pod reporting idle, which covers a running turn, an open terminal and kept background work.
The job re-reads each Agent before deciding, probes the pod after that read, and writes against that read's version, so a connection, a wake or an activity stamp in between makes the write conflict, and the Agent is decided again later.
A prompt arriving in the seconds between the write and the pod's restart is the one window it cannot close.

A move never strands an Agent.
It records the image the Agent came from until the Agent has stayed ready on the new spec for five minutes, so a container that crashes seconds after it becomes ready does not prove the move.
If the controller instead reports, for that spec, a failure the image can cause, the job writes the old image back and marks the new one refused for that Agent, which is not moved to it again; a later image is tried as usual.
The failures are: the image cannot be pulled or unpacked, the machine cannot boot it, or the controller's `StartFailed` condition.
The controller sets `StartFailed` only from the pod or machine that runs the current spec, or from a refusal to admit that spec, never from the pod a roll replaces, which exits too.
On the container backend that is a pod of the agent StatefulSet's update revision, once the StatefulSet has observed its generation.
On the vm backend the runner's status names no spec, but a restart in flight reads not ready, so the controller counts from the first read at the current generation.
The controller sets `StartFailed` for one of three reasons.
Either the container, or a guest that answered and then went quiet, restarted three times on this spec and is not ready now.
Or it ran on this spec and never became ready, not counting the time an image pull takes: for ten minutes in a container, or for two minutes in a vm machine.
Or, on the container backend, admission refused the agent StatefulSet with this spec's image, as a cluster policy that blocks images older than a year does.
The old pod then keeps running and no pod of the new spec ever starts, so the refusal is the only failure there is to report.
It counts only when the refused write changes the agent container's image: a refusal of a StatefulSet already on that image is not the new image's fault, and a move back would not cure it.
The vm bound is short because a moved vm Agent takes the new image when it wakes, and the vm idle timeout hibernates it again five minutes later.
At ten minutes, the runner's own restart of the quiet guest would also stop the clock first.
An exit from out of memory or a full home volume does not count, since any image meets it.
A harness that crash-loops on any image, from something in the Agent's home, also moves the Agent back, and the new image is then refused for this Agent although it is not at fault.
The owner's Update stays available, to move a running Agent now, and says so when the Agent failed to start on that image.
