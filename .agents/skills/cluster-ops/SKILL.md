---
name: cluster-ops
description: Operate the local k3s dev cluster (lima) and the Playwright e2e suite, and recover from mesh/cert failures. Use when working with the local cluster, running or debugging e2e tests, or when any of these symptoms appear - the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step or fails at a webhook admission with an expired certificate, an agent's runtime repeats `[runtime] hello failed` in its machine's guest log, `e2e:loop` fails against a warm cluster, or an image build dies with `no space left on device` while the host disk still has room. Also when installing DAM into an Environment (`cluster:install -- --environment`, `cluster:open`). Triggers on "cluster:install", "cluster:status", "e2e:loop", "fix-certs", "cluster:prune", "lima", "k3s", "ztunnel", "waypoint", "Istio SVID", "no space left on device", "issue #283", "no-mesh", "istio-cni", "conntrack". Also when pods sit in ContainerCreating with `FailedCreatePodSandBox ... nftables run failed ... Operation not supported`, or istio-cni crash-loops on `error initializing host addressSet manager`.
---

# Cluster operations

In a Claude Code on the web session (`CLAUDE_CODE_REMOTE=true`), read [ccweb](../ccweb/SKILL.md) first: the cluster there needs `IS_SANDBOX=1`, a k3s launcher, and pulled rather than built images.

## Cluster lifecycle (k3s via lima)

`mise tasks` lists every `cluster:*` task.
The common ones:

- `cluster:install` — create the k3s VM, build images, install cert-manager + the Platform chart (upgrades in place if already installed)
- `cluster:build -- <controller|api-server|ui|keycloak|agents>…` — rebuild those images and restart just their pods (`agents`: every deployed agent image)
- `cluster:status` — pods and cluster state
- `cluster:install -- --no-mesh` — local-only install with no Istio dataplane, for kernels that cannot run ambient (see below)
- `cluster:kubectl -- logs -l app.kubernetes.io/component=apiserver --all-containers` — api-server pod logs
- `cluster:fix-certs` — recover from expired dev-cluster certs (see below)
- `cluster:stop` / `cluster:uninstall` / `cluster:delete`

Every `cluster:*` task honors `LIMA_INSTANCE` (default `platform-k3s`) to target another VM, e.g. the e2e cluster `platform-k3s-test`; the `e2e:*` tasks and the Playwright run task pin that one themselves.

Services are at `*.localhost:4444` (Traefik, auto-forwarded by lima); `*.localtest.me:4444` is an alias.

## Where and which

Every `cluster:*` and `e2e:*` task resolves two things before it does anything, in [`.mise/lib/cluster.sh`](../../../.mise/lib/cluster.sh), and says them as its first line (on stderr, so a task's stdout stays parseable):

```
→ lima platform-k3s · install profiles (branch) · http://localhost:4400
→ environment pr-123 · install default
```

- **The target** — which cluster: `environment:<name>` with `--environment <name>` (or a `CLUSTER_ENVIRONMENT` already in the shell), `host` with `IS_SANDBOX` (k3s on this machine), otherwise `lima`, the `LIMA_INSTANCE` VM (default `platform-k3s`; the e2e lane pins `platform-k3s-test`).
- **The install** — which install on that cluster: `--name <name>`, else `DAM_INSTALL`, else a linked worktree's branch slug.

The line names where each part came from: the flag, the variable, the branch, the repository's own checkout, or the sandbox.
Every task that declares flags declares both `--environment` and `--name`, so mise never rejects one of them: `mise run cluster:status --environment pr-123`, `mise run cluster:build -- --name sidebar api-server`.

### The name rule

| Target                          | Install                                                                     | Where the name comes from                                |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| lima, the repository's checkout | `default`                                                                   | nothing to name: that checkout owns it                   |
| lima, a linked worktree         | the branch slug: `[a-z0-9-]`, at most 20, never `default`, never `*-agents` | the branch; `--name` or `DAM_INSTALL` overrides it       |
| lima, `--name`/`DAM_INSTALL`    | that name; `default` joins the default install                              | the flag or the variable                                 |
| host (`IS_SANDBOX`)             | `default`                                                                   | a sandbox is this agent's own cluster; a name is refused |
| environment:`<name>`            | `default`                                                                   | an Environment holds one install; a name is refused      |

An explicit `--name`/`DAM_INSTALL` is refused when it is longer than 20 characters, holds anything but `[a-z0-9-]`, or ends in `-agents` (its namespace `platform-<name>` would be another install's `platform-<name>-agents`); a branch whose slug would do either is refused the same way, so pass `--name`.
A name is fixed once the install exists, so a new branch in one worktree is a second install, not a rename.
`DAM_INSTALL=default` in a worktree joins the default install.

### What each target and install gets

|                     | lima, `default`                           | lima, named                                                            | host (`IS_SANDBOX`) | environment:`<name>`                                                                                   |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Port                | 4444                                      | the first free one of 4400–4499                                        | 4444                | the ingress on `--backchannel-port` (4444), the endpoints' bridge on their own port                    |
| Host names          | `*.localhost`, `*.localtest.me`           | the same, on the install's port                                        | the same            | the Environment's `app`/`keycloak`/`share`/`content` endpoints; `--backchannel` adds a `localhost` set |
| Image tags          | `:latest`                                 | `platform-<component>:<name>`                                          | `:latest`           | `:latest`, and a component the registry has is pulled by the node, not built here                      |
| Host runner (a Mac) | 4600, `~/.local/state/platform-vm-runner` | 4601–4699, a directory of its own                                      | none: runner pods   | none: runner pods, and the Mac's runner is never touched                                               |
| Mesh                | the cluster's                             | follows the cluster's; `--no-mesh` is refused while the dataplane runs | the cluster's       | always none: the Environment's kernel cannot run ambient                                               |
| CRDs                | re-applied on every run                   | only the ones the cluster lacks                                        | re-applied          | re-applied: it is the cluster's only install                                                           |
| ClickStack          | allowed                                   | refused: the operators are cluster-scoped                              | allowed             | allowed                                                                                                |
| Node and API        | the lima VM                               | the lima VM                                                            | this host           | `ssh env-<name>` over the Environment Link, the API through a tunnel                                   |

**Guards**, so a wrong target fails loudly instead of acting on something else:

- the `e2e:*` tasks refuse a `CLUSTER_ENVIRONMENT` left in the shell: the lane pins its own VM and the default install, and an Environment would outrank both, so the lane goes into an Environment only when an `e2e:*` task is given `--environment <name>` ([The e2e suite in an Environment](#the-e2e-suite-in-an-environment));
- `cluster:build` and `cluster:helm` refuse an install that is not on the cluster, and name `cluster:install`;
- `cluster:uninstall`, `cluster:delete` and `cluster:host-runner` refuse the targets they cannot act on: an Environment's install goes with the Environment, and a host runner serves a lima VM;
- `cluster:installs --all` lists every install on the target cluster, its namespace, address, status and — on a Mac — its host runner; `cluster:installs --environment <name>` shows that Environment's install in the same columns.

## Several installs on one cluster

On a lima cluster several installs live side by side, one per worktree; the name rule and the flags are in [Where and which](#where-and-which) above.
Each install is a Helm release `platform-<name>` in namespace `platform-<name>`, with agent namespace `platform-<name>-agents`, its own port, its own images tagged `platform-<component>:<name>`, its own ClusterIssuers and CA secrets, and — on a Mac — its own host runner.
The repository's own checkout is the **default** install and keeps the old names — release `platform`, namespace `default`, agents in `platform-agents`, port 4444, images `:latest` — and so does the e2e lane (`DAM_INSTALL=default` in the `e2e:*` tasks, on its own VM).
A *linked* worktree never gets the default install, `main` included: only the repository's own checkout owns `default`, so two checkouts cannot land on one install by accident.

- `mise run cluster:install` (or `cluster:helm`, `cluster:build`) — all install-aware; `--name <name>` names another one, and `build`/`helm` need one that exists.
- `mise run cluster:installs -- --all` — every install, its namespace, its address and status, plus every host runner.
- `mise run cluster:uninstall` — removes this worktree's install only: its runner, its entrypoint, its agent namespace, the chart, the PVCs, its namespace, the runner PriorityClass the chart keeps and its CA secrets.
- `mise run cluster:status` — this worktree's pods (and the install list).

**A port per install, one Traefik.**
Every install serves the same host names (`localhost`, `keycloak.localhost`, `share.`, `content.`, `*.env.localhost`) on a port of its own: 4444 for the default install, otherwise the first free port of 4400–4499.
One Lima port-forward rule carries that whole range to this host (`etc/lima/k3s.yaml`); the first install of a cluster adds it and restarts the VM once (Lima reads forwards at start), and `cluster:install` checks for it on every run, so it happens at most once per VM.
The cluster's one `HelmChartConfig traefik` holds an entrypoint per install (`platform`, `platform-<name>`), merged rather than overwritten: `traefik_entrypoint_port` re-reads it and writes it back with a compare-and-swap on the object's `resourceVersion`, so two installs starting at once take two ports and neither drops the other's entrypoint; that config is also the only record of which port is whose (`cluster:installs` reads it).
Each install's Ingress names its entrypoint (`ingress.annotations.traefik.ingress.kubernetes.io/router.entrypoints`), because Traefik attaches a router with no entrypoints to all of them.
A named install also sets `router.priority=1000`: an Ingress installed before the annotation existed — the default install's, until its next `cluster:install` — still claims `Host(localhost)` on every entrypoint, and Traefik breaks that tie by rule length.
Traefik gives every router an Ingress makes that Ingress's priority, so the host-less catch-all rule (`ingress.catchAllAppHost`) has an Ingress of its own.
`cluster:install` gives it `ingress.catchAllPriority=100` on a named install: the explicit hosts (1000) win over the catch-all, and the catch-all wins over the rule-length priority of a stale Ingress, so `keycloak.localhost` is Keycloak and `dam.localhost` reaches this install rather than the default one.

**Per-install image tags.**
A tag is node-wide state, so a named install aliases every local image it imports (`k3s ctr -n k8s.io images tag`), names its values' `platform-*` images `:<name>`, and stages its agent images under that reference.
The default install keeps `:latest`, which any install's import still overwrites: rebuild in one worktree and the *default* install's pods run its build until it rebuilds too.

**A host runner per install, on a Mac.**
Each install's runner keeps its own directory (`~/.local/state/platform-vm-runner/<name>`, the default install's is the base directory), its own token and TLS certificate (the chart names them after the release), its own port (4600 for the default install, otherwise the first free one of 4601–4699, recorded in `port` beside its token) and its own 100 machine ports (`33000 + 100*(port-4600)`).
The controller dials it at `virtualization.runner.hostPort`, so each install's controller reaches its own.
The program (the runner binary, the smolvm release, the guest kernel) and the image volume are shared, because they are the same files for every install.
A runner's memory is an admission ceiling, not a reservation: the default install takes a third of the Mac's RAM, a named install a quarter, and `PLATFORM_VM_RUNNER_MEMORY_MIB` overrides it — two runners are two ceilings on one Mac's real CPU and RAM.
On a host with `/dev/kvm` (Linux, a sandbox, or a Mac VM created with nesting) an install runs its agents on runner pods instead, and none of this applies.

**What stays cluster-wide, and why:**

- the CRDs: cluster-scoped and install-only.
  The **default** install re-applies `helm/crds/` on every run, which is what keeps the local cluster's schema current; a **named** install skips them unless a CRD is missing, so a worktree's schema change cannot rewrite the CRDs every install on the cluster runs against.
  Helm's own `crds/` copy is skipped once the kinds exist (`--skip-crds`);
- cert-manager, the Gateway API CRDs and the Istio mesh — one per cluster, and a named install follows the cluster's mesh mode rather than changing it (`--no-mesh` is refused when the dataplane is there, and only the default install writes the `kube-system/platform-local-no-mesh` marker),
- the KVM device plugin (one per node; a named install applies the same manifest),
- ClickStack (`CLICKSTACK=1`) — its operators are cluster-scoped and watch one namespace, so only the default install may run it,
- the runner pods' node path `/var/lib/platform-vm-images` (per-release subdirectories), the build caches, `~/platform-src.d`, and a Mac's hypervisor.

Nothing serialises installs that run at the same time: they share the CRD apply, the Traefik `HelmChartConfig`, the KVM device plugin, the image import and the image prune.
Every one of those is idempotent on a warm cluster, and none is safe on a fresh one (Istio and cert-manager install on a check-then-install): install the default install first, then the others.

## In an Environment

An agent on the vm backend installs DAM into one of its own [Environments](../../../docs/architecture/environments.md), from the current checkout, so a reviewer can open the change at the Environment's addresses.

1. **Create the Environment** with the `create_environment` tool (a shell cannot), with four endpoints on one port that is not 4444, which the install's own ingress uses: `app`, `keycloak`, `share` and `content`, each → `4400`.
   The install stops and names what is missing when they are not there.
   An Environment has no mesh, so the install runs without one, and the default `expires` of a week is usually right.
   Every agent runs as a machine on a VM runner, so the Environment's guest needs `/dev/kvm`, and the install refuses without it.
   Nothing in `create_environment` asks for nesting: the Environment's machine nests through the install's `controller.agent.harnessTemplateDefaults.nestedVirtualization` and `virtualization.runner.nestedVirtualization`, both on by default, on a node whose KVM allows it; an install that turns either off gives it none.
2. **Install, or upgrade:** `mise run cluster:install -- --environment <name>`.
   It starts the Environment's k3s (in its default runlevel, so it comes back after the Environment sleeps), and reaches it over the Environment Link: `ssh env-<name>` for the node, a tunnel on a free local port for the API.
   Each platform and agent image whose source the registry has (`image:resolve` says REUSE) is pulled by the node itself, so a run on main builds nothing; a changed one is built here and streamed in with `k3s ctr images import -`.
   The chart's URLs are the endpoints' addresses, with the outer gateway's CA and address from the Environment itself.
   A second run upgrades in place, as on lima.
3. **Open it** at the `app` address the install prints, signed in as the owner or someone on the agent's list.

Every `cluster:*` task takes `--environment <name>` to act on the Environment instead of this host's cluster: `cluster:kubectl -- --environment <name> get pods`, `cluster:helm -- --environment <name>`, `cluster:status --environment <name>`, `cluster:shell -- --environment <name> <cmd>`, `cluster:build --environment <name> api-server`.
An Environment holds one install, so the install there is always the default one and `--name` is refused ([Where and which](#where-and-which)); the worktree's branch plays no part.
The link stays open for ten idle minutes after the last task, and while it is open neither machine sleeps.

What it installs beside the chart:

- **A host-name bridge**, an Envoy on the node's network on the endpoints' port.
  The gate hands each request to `127.0.0.1:<port>` with `Host: 127.0.0.1:<port>`, and the ingress routes by host name, so the bridge puts `X-Forwarded-Host` back as the host, and states the public scheme and port.
- **Traefik's app entrypoint trusts forwarded headers**, so `X-Forwarded-Proto: https` reaches Keycloak and its cookies are `Secure`.
  Only the node's loopback reaches that entrypoint.

**Signing in from the agent's own browser** needs the backchannel addresses (`backchannel.*` in the values): `cluster:install -- --environment <name> --backchannel` turns them on at `http://localhost:4444`, and `mise run cluster:open -- --environment <name>`, started in the background, forwards that port to this agent.
`--backchannel-port <port>` moves them; `cluster:open` then needs the same `--port <port>`, as the command the install prints at its end has.
The agent then opens `http://localhost:4444` in its browser and signs in as `dev`/`dev`.

The Environment's k3s API listens on 16443, as every local k3s does, and the tunnel follows the port its kubeconfig names: an Environment whose cluster was made on 6443, before the image's k3s service moved, keeps 6443 until it is made again.

An Environment created before its image passed the image's `PATH` on to an SSH shell finds no `k3s` or `kubectl` in `ssh env-<name>`, and `rc-service k3s start` there reports success and runs nothing.
The cluster tasks load the tools' PATH from the image's mise themselves; in a shell of your own, run `eval "$(MISE_SYSTEM_DATA_DIR=/usr/share/mise mise env -s bash)"` first.

## E2E tests (Playwright)

- `mise run e2e` — full from-scratch run: nuke the test VM, install a fresh cluster, run specs, tear down (the CI path)
- `mise run e2e:loop` — fast rerun against a warm test cluster: bootstrap once if missing, optionally rebuild components, wipe data, run specs.
  Options: `--headed --full --rebuild=controller,api-server,ui,keycloak,agents --test=<filter>` (`--rebuild=` rebuilds nothing without asking)
- `mise run e2e:reset` — data wipe only: drop+recreate the platform DB, delete agents (CMs/sts/pods/PVCs) and VM runners, clear stored Playwright auth.
  Leaves the cluster running

`e2e:loop` keeps a persistent `platform-k3s-test` VM, so reruns skip VM/Istio/cert-manager/Keycloak provisioning; `mise run e2e` nukes it (shared name) and the next `e2e:loop` bootstraps a fresh one.
`e2e:loop` never heals a wedged cluster: it fails loud, and the fix is `mise run e2e` or `cluster:fix-certs`.
Iterate with `e2e:loop`; use `e2e` after helm/realm/infra changes.

**Suite tiers.** **Smoke** (`src/tests/smoke/`) is what CI (both jobs, see [VM runner](#vm-runner-kvm)) and plain `e2e` / `e2e:loop` run.
**Full** adds the slow scenario specs under `src/tests/full/`, on demand only: `mise run e2e:loop -- --full` (fresh cluster: `mise run e2e -- --full`).
`src/tests/full/` specs: one `<area>-full` Playwright project per area, self-contained (own agents, own token via `getAccessToken` + `acceptTerms`, no smoke-chain fixtures), motivating ticket in the test title.

### The e2e suite in an Environment

`mise run e2e:loop -- --environment <name>` runs the smoke suite for the current checkout in one of this agent's Environments, the same way every time.
It is the command the agent kit's `verify_environment` names: `mise run e2e:loop -- --environment {environment}`.
The Environment is one made as in [In an Environment](#in-an-environment), on an install whose agents nest, since every agent the suite creates is a machine.

1. **Install what changed.** `e2e:install -- --environment <name>` runs every time, through `cluster:install -- --environment <name> --backchannel`, with the lane's values (mock agents, the e2e control API, one vCPU and 1Gi a boot) and the default harness Template.
   An image the registry has for this checkout's source is pulled by the node; one it lacks is built here and streamed in, unless the node already holds that build.
   Only a deployment whose image changed is restarted, and only an agent image that changed is staged again, from the node's own copy, so a second run that changed nothing changes nothing.
2. **Reset and gate**, as on the test cluster: `e2e:reset` and `e2e:gate` take `--environment` too.
3. **Run the suite on the backchannel.** The lane's backchannel answers at `localhost:<port>` and `keycloak.localhost:<port>`, on a port of the Environment's own from 6560–6599, so the local lane's 6555 and several Environments run side by side on one agent.
   The port is the one the install already answers on, else the first one no other of this agent's Environments holds; the agent's `~/.cache/platform-cluster/env-<name>/e2e-port` records it.
   One SSH link forwards that port and the Environment's k3s API to this agent for as long as the suite runs, and the specs that act on the cluster (`kubectl`, `helm`) use that API through `KUBECONFIG`.
   The specs run here, and the browser they drive runs in the Environment: Playwright's browser server, from this checkout's `playwright-core`, on the Environment's loopback, reached over its own forward through `PW_TEST_CONNECT_WS_ENDPOINT`, so a busy agent slows the specs' own calls but not the pages they load.
   The browser is the image's when it is this Playwright's revision, else one installed into the Environment's home once; traces, videos and the report come back over the connection into the checkout, as a local run leaves them, and `--headed` is refused, since there is no window to open there.
   Each lane has its own Keycloak login lock port, so two suites never wait on each other's logins.

Two Environments share nothing but this agent, which builds their changed images and runs their specs: each has its own k3s, install, browser, data and port.
Two runs on one Environment at once are not supported: they would reset each other's data.
Run two Environments from two checkouts (an agent's slots are): the suite keeps its login and its report in the checkout's `packages/e2e/playwright`.

What differs from the local lane:

- **No mesh**: the Environment's kernel cannot run ambient, so no AuthorizationPolicy is enforced there, and the run says nothing about isolation; CI's lanes still cover it.
- **`mise run e2e` refuses `--environment`**: it deletes its cluster before and after the suite, and an Environment's install goes with the Environment.
  For a fresh Environment, delete it and create it again.
- **`--rebuild`** does nothing there: the install already took every change of the checkout.
- **No spec is skipped there by design**: the specs that reach into the cluster or a runner (`19-agent-machine`, `22-harness-tools`, `27-vm-boot-matrix`, `28-runner-release`, `29-vm-storage-trim`) reach the Environment's own through its API.
  `28-runner-release` derives its second runner release from the registry's runner image the Environment pulled, or from the one built here, and streams it in.

## No mesh (local only)

Some kernels can't run Istio's ambient dataplane: smolvm's guest kernel lacks ipset and conntrack marks and zones, exactly what istio-cni's per-pod nftables rules set.
There, istio-cni crash-loops on `error initializing host addressSet manager: invalid argument`, and pods stay in ContainerCreating with `FailedCreatePodSandBox: ... nftables run failed ... Operation not supported`.
`cluster:install -- --no-mesh` installs Istio's CRDs and no dataplane, removing any dataplane an earlier install left, and installs the chart with `istio.enforce=false`.
Everything runs, and every AuthorizationPolicy exists, but **nothing enforces them**: no mTLS, and any pod can call the harness as any agent.
Its test results say nothing about isolation.

Local-only on purpose: the task refuses to run under CI, and the chart refuses `istio.enforce=false` without the `kube-system/platform-local-no-mesh` ConfigMap the task writes, so `helm template`, a GitOps render and every other cluster fail.
`cluster:status` says NO MESH while the marker is there.
A later `cluster:install` without the flag installs the mesh again and removes the marker.
Pass the flag on every run you want to stay mesh-free, `cluster:helm` included.

Inside the platform's own agent sandboxes (such a kernel), `PLATFORM_SANDBOX` is set and implies `--no-mesh` on every install, with a warning banner at the start and the end; the marker's `created-by` names the variable.
Unset it to try the mesh anyway.

## VM runner (KVM)

Every agent is a microVM, so `cluster:install` needs a host that can run machines, and fails where it cannot open `/dev/kvm`.
On a Mac it runs agents on a runner of the install's own, on the Mac's own hypervisor, outside the cluster ([host runner](../../../docs/architecture/vm-host-runner.md)): `cluster:host-runner` rebuilds and restarts it (after a reboot too), its log is `~/.local/state/platform-vm-runner/runner.log`, with a named install's under that directory's `<name>/`, and `PLATFORM_NESTED_VIRT=1` picks the runner pods instead.
Everywhere else, and in the e2e install, the runner pods need a usable `/dev/kvm` on the k3s node: nested virtualization in the lima VM (Apple silicon M3+, macOS 15+), or a KVM host in sandbox mode; `cluster:install` then applies the KVM device plugin (`helm/extra/kvm-device-plugin.yaml`), and values-local.yaml names its `squat.ai/kvm` and the node image cache directory.
The e2e install keeps the runner pods on a Mac too, since the suite restarts the runner by deleting its pod.
`mise run e2e` (or `e2e:loop` bootstrapping a fresh test VM) stages the mock image for the VM runners and runs the smoke suite; `E2E_GATEWAY_PER_OWNER=1` installs with one gateway pod per owner (`virtualization.gateway.perOwner`) instead of the default gateway pod per agent.
Boot waits are four minutes for a boot and five for a smoke test, so a guest that stops answering fails the run in minutes.

`smoke/19-agent-backend.spec.ts` (boot and chat, a file in HOME, a schedule fire, hibernate/wake, the restart verb, and the runner pod deleted, each keeping HOME) deletes the owner's whole VM runner, which also runs every other agent of the e2e user, so it runs after the rest of the suite.

CI runs the smoke suite as two jobs on every run but a tag and a docs-only PR (e2e.yml's `docs-only` job): `e2e / mise e2e (vm, per-agent gateway)` (`e2e-agent-gateway`) on the chart's default gateway pod per agent, and `e2e / mise e2e (vm, owner gateway)` (`e2e-owner-gateway`, the same steps through YAML anchors, plus `E2E_GATEWAY_PER_OWNER=1`), each on its own GitHub-hosted x64 runner.
A pull request runs the per-agent job alone, with a reduced set of the specs, the ones that fail for real there; the owner gateway's job, and every spec, run in a merge group, the nightly run and a dispatch ([e2e architecture](../../../docs/architecture/e2e.md)).
Each job's runner exposes `/dev/kvm`, which a udev rule opens to the runner user, and builds or pulls the vm-runner beside the other images.
A failure in one job alone is its gateway topology's.

`cluster:install` stages the vm images beside the chart install, as soon as the agent images are loaded, not after the deployments are ready.
`e2e:install` gives each machine one vCPU and a 1Gi boot estimate: each runner's memory request follows its booting machines' estimates plus a 512Mi reserve, while the 16 GB CI node has little room beside the control plane.
Both jobs' summaries show where their time went: with `E2E_TIMINGS=<file>`, `cluster:install`, `e2e:install` and `e2e:run` append phase marks to it (`e2e_mark` in `.mise/lib/cluster.sh`), and `.mise/tasks/e2e/timings` renders them as Markdown, with the per-project spans from the Playwright JSON report that `E2E_REPORT_JSON` names.
A job that never reached a phase prints `n/a` for its rows, so one job's table compares with the other's.

## Disk space (the k3s VM)

No image build uses a container runtime.
Each `:oci` task writes a tar to its package's `dist/oci/`; `cluster:import` copies it into the k3s VM (`platform-k3s`, 200 GiB per `etc/lima/k3s.yaml`) for `k3s ctr images import`.
On macOS the Linux-only images (agent images, VM runner) also build in that VM, so its one disk holds their build caches beside the cluster's containerd.

**Symptom.** A build or import fails with `no space left on device` while the Mac has room.
The full disk is the VM's; host `df -h /` measures the wrong filesystem:

```
mise run cluster:shell -- df -h /
mise run cluster:shell -- sh -c 'du -sh ~/.cache/platform-agent-oci ~/.cache/platform-vm-runner'
```

**Reclaim.** `mise run cluster:prune` removes dangling k3s images and leftover import tars.
On the host, `mise run prune` (`-- --dry-run` to list first) does that too, and removes the checkout's stale cargo profiles and image tars and its Playwright output; it keeps the warm build, so run it when a work item is done.
Inside the VM, the VM runner's cargo target (`~/.cache/platform-vm-runner/target`) only grows; removing it costs the next build its warm start.
`~/platform-src.d` holds one source copy per checkout and building task; copies of deleted worktrees stay there until removed.
Growing the VM's disk is the other lever.
On the host, `~/.cache/platform-image-pack` keeps every base `image:pack` has used, one per pin, and a bumped pin leaves the old one there until you remove it.

## Cluster debugging

Use `mise run cluster:kubectl -- <args>` and `mise run cluster:shell -- <cmd>` (auto-approved in .claude/settings.json), not raw `kubectl` or `export KUBECONFIG=...`.
For interactive use: `export KUBECONFIG="$(mise run cluster:kubeconfig)"`.

If in-mesh traffic misbehaves — the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step with a misleading `Connection reset`, or a new agent never seeds its workspace (the guest's own log repeats `[runtime] hello failed` — a machine has no pod log, its console is what a failed boot leaves) — suspect expired Istio ambient workload SVIDs.
`mise run cluster:status` reports the expired-cert signature; the `ztunnel-cert-watchdog` CronJob in `istio-system` then rolls `ds/ztunnel` and the waypoints within ~10 min, and `mise run cluster:fix-certs` does it now.
The same suspend/resume clock skip can expire cert-manager's webhook serving cert (`cluster:install` fails at admission with `failed calling webhook ... certificate has expired`) — `cluster:status` probes for it and `cluster:fix-certs` heals it too.
