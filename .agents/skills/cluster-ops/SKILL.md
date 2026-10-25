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

## In an Environment

An agent on the vm backend installs DAM into one of its own [Environments](../../../docs/architecture/environments.md), from the current checkout, so a reviewer can open the change at the Environment's addresses.

1. **Create the Environment** with the `create_environment` tool (a shell cannot), with four endpoints on one port that is not 4444, which the install's own ingress uses: `app`, `keycloak`, `share` and `content`, each → `4400`.
   The install stops and names what is missing when they are not there.
   An Environment has no mesh, so the install runs without one, and the default `expires` of a week is usually right.
   Every agent runs as a machine on a VM runner, so the Environment's guest needs `/dev/kvm`, and the install refuses without it.
   Nothing in `create_environment` asks for nesting: the Environment's machine nests only when the install that owns it sets `controller.agent.harnessTemplateDefaults.nestedVirtualization: true` and lets its runners nest (`virtualization.runner.nestedVirtualization`), on a node whose KVM allows it.
2. **Install, or upgrade:** `mise run cluster:install -- --environment <name>`.
   It starts the Environment's k3s (in its default runlevel, so it comes back after the Environment sleeps), and reaches it over the Environment Link: `ssh env-<name>` for the node, a tunnel on a free local port for the API.
   Each platform and agent image whose source the registry has (`image:resolve` says REUSE) is pulled by the node itself, so a run on main builds nothing; a changed one is built here and streamed in with `k3s ctr images import -`.
   The chart's URLs are the endpoints' addresses, with the outer gateway's CA and address from the Environment itself.
   A second run upgrades in place, as on lima.
3. **Open it** at the `app` address the install prints, signed in as the owner or someone on the agent's list.

Every `cluster:*` task takes `--environment <name>` first to act on the Environment instead of this host's cluster: `cluster:kubectl -- --environment <name> get pods`, `cluster:helm -- --environment <name>`, `cluster:status -- --environment <name>`, `cluster:shell -- --environment <name> <cmd>`, `cluster:build --environment <name> api-server`.
The link stays open for ten idle minutes after the last task, and while it is open neither machine sleeps.

What it installs beside the chart:

- **A host-name bridge**, an Envoy on the node's network on the endpoints' port.
  The gate hands each request to `127.0.0.1:<port>` with `Host: 127.0.0.1:<port>`, and the ingress routes by host name, so the bridge puts `X-Forwarded-Host` back as the host, and states the public scheme and port.
- **Traefik's app entrypoint trusts forwarded headers**, so `X-Forwarded-Proto: https` reaches Keycloak and its cookies are `Secure`.
  Only the node's loopback reaches that entrypoint.

**Signing in from the agent's own browser** needs the backchannel addresses (`backchannel.*` in the values): `cluster:install -- --environment <name> --backchannel` turns them on at `http://localhost:4444`, and `mise run cluster:open -- --environment <name>`, started in the background, forwards that port to this agent.
`--backchannel-port <port>` moves them; `cluster:open` then needs the same `--port <port>`, as the command the install prints at its end has.
The agent then opens `http://localhost:4444` in its browser and signs in as `dev`/`dev`.

An Environment created before its image passed the image's `PATH` on to an SSH shell finds no `k3s` or `kubectl` in `ssh env-<name>`, and `rc-service k3s start` there reports success and runs nothing.
The cluster tasks load the tools' PATH from the image's mise themselves; in a shell of your own, run `eval "$(MISE_SYSTEM_DATA_DIR=/usr/share/mise mise env -s bash)"` first.

## E2E tests (Playwright)

- `mise run e2e` — full from-scratch run: nuke the test VM, install a fresh cluster, run specs, tear down (the CI path)
- `mise run e2e:loop` — fast rerun against a warm test cluster: bootstrap once if missing, optionally rebuild components, wipe data, run specs.
  Options: `--headed --full --rebuild=controller,api-server,ui,keycloak,agents --test=<filter>` (`--rebuild=` rebuilds nothing without asking)
- `mise run e2e:reset` — data wipe only: drop+recreate the platform DB, delete agents (CMs/sts/pods/PVCs), clear stored Playwright auth.
  Leaves the cluster running

`e2e:loop` keeps a persistent `platform-k3s-test` VM, so reruns skip VM/Istio/cert-manager/Keycloak provisioning; `mise run e2e` nukes it (shared name) and the next `e2e:loop` bootstraps a fresh one.
`e2e:loop` never heals a wedged cluster: it fails loud, and the fix is `mise run e2e` or `cluster:fix-certs`.
Iterate with `e2e:loop`; use `e2e` after helm/realm/infra changes.

**Suite tiers.** **Smoke** (`src/tests/smoke/`) is what CI (both jobs, see [VM runner](#vm-runner-kvm)) and plain `e2e` / `e2e:loop` run.
**Full** adds the slow scenario specs under `src/tests/full/`, on demand only: `mise run e2e:loop -- --full` (fresh cluster: `mise run e2e -- --full`).
`src/tests/full/` specs: one `<area>-full` Playwright project per area, self-contained (own agents, own token via `getAccessToken` + `acceptTerms`, no smoke-chain fixtures), motivating ticket in the test title.

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
On a Mac it runs agents on one runner on the Mac's own hypervisor, outside the cluster ([host runner](../../../docs/architecture/vm-host-runner.md)): `cluster:host-runner` rebuilds and restarts it (after a reboot too), its log is `~/.local/state/platform-vm-runner/runner.log`, and `PLATFORM_NESTED_VIRT=1` picks the runner pods instead.
Everywhere else, and in the e2e install, the runner pods need a usable `/dev/kvm` on the k3s node: nested virtualization in the lima VM (Apple silicon M3+, macOS 15+), or a KVM host in sandbox mode; `cluster:install` then applies the KVM device plugin (`helm/extra/kvm-device-plugin.yaml`), and values-local.yaml names its `squat.ai/kvm` and the node image cache directory.
The e2e install keeps the runner pods on a Mac too, since the suite restarts the runner by deleting its pod and the one host runner belongs to the dev cluster.
`mise run e2e` (or `e2e:loop` bootstrapping a fresh test VM) stages the mock image for the VM runners and runs the smoke suite; `E2E_GATEWAY_PER_OWNER=1` installs with one gateway pod per owner (`virtualization.gateway.perOwner`) instead of the default gateway pod per agent.
Boot waits are four minutes for a boot and five for a smoke test, so a guest that stops answering fails the run in minutes.

`smoke/19-agent-backend.spec.ts` (boot and chat, a file in HOME, a schedule fire, hibernate/wake, the restart verb, and the runner pod deleted, each keeping HOME) deletes the owner's whole VM runner, which also runs every other agent of the e2e user, so it runs after the rest of the suite.

CI runs the smoke suite as two jobs on every run but a tag and a docs-only PR (e2e.yml's `docs-only` job): `e2e / mise e2e (vm, per-agent gateway)` (`e2e-agent-gateway`) on the chart's default gateway pod per agent, and `e2e / mise e2e (vm, owner gateway)` (`e2e-owner-gateway`, the same steps through YAML anchors, plus `E2E_GATEWAY_PER_OWNER=1`), each on its own GitHub-hosted x64 runner.
On a pull request both jobs run a reduced set of the specs, the ones that fail for real there; a merge group, the nightly run and a dispatch run all of them ([e2e architecture](../../../docs/architecture/e2e.md)).
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
