---
name: cluster-ops
description: Operate the local k3s dev cluster (lima) and the Playwright e2e suite, and recover from mesh/cert failures. Use when working with the local cluster, running or debugging e2e tests, or when any of these symptoms appear - the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step or fails at a webhook admission with an expired certificate, an agent pod repeats `[runtime] hello failed`, `e2e:loop` fails against a warm cluster, or an image build dies with `no space left on device` while the host disk still has room. Triggers on "cluster:install", "cluster:status", "e2e:loop", "fix-certs", "cluster:prune", "lima", "k3s", "ztunnel", "waypoint", "Istio SVID", "no space left on device", "issue #283".
---

# Cluster operations

In a Claude Code on the web session (`CLAUDE_CODE_REMOTE=true`), read [ccweb](../ccweb/SKILL.md) first: the cluster there needs `IS_SANDBOX=1`, a k3s launcher, and pulled rather than built images.

## Cluster lifecycle (k3s via lima)

`mise tasks` lists every `cluster:*` task with its description. The ones you'll reach for most:

- `cluster:install` — create the k3s VM, build images, install cert-manager + the Platform chart (upgrades in place if already installed)
- `cluster:build -- <controller|api-server|ui|keycloak|agents>…` — rebuild those images and restart just their pods (`agents`: every deployed agent image)
- `cluster:status` — pods and cluster state
- `cluster:logs` — api-server pod logs
- `cluster:fix-certs` — recover from expired dev-cluster certs (see below)
- `cluster:stop` / `cluster:uninstall` / `cluster:delete`

Every `cluster:*` task honors a `LIMA_INSTANCE` env var (default `platform-k3s`); set it to target a different VM (e.g. the e2e cluster, `platform-k3s-test`). The `e2e:*` tasks and the Playwright run task pin `platform-k3s-test` themselves.

Services are available at `*.localhost:4444` automatically (Traefik on port 4444, auto-forwarded by lima). `*.localtest.me:4444` also works as an alias.

## E2E tests (Playwright)

- `mise run e2e` — full from-scratch run: nuke the test VM, install a fresh cluster, run specs, tear down (the CI path)
- `mise run e2e:loop` — fast rerun against a warm test cluster: bootstrap once if missing, optionally rebuild components, wipe data, run specs. Options: `--headed --full --rebuild=controller,api-server,ui,keycloak,agents --test=<filter>` (`--rebuild=` rebuilds nothing without asking)
- `mise run e2e:reset` — data wipe only: drop+recreate the platform DB, delete agents (CMs/sts/pods/PVCs), clear stored Playwright auth. Leaves the cluster running

`e2e:loop` runs on a dedicated persistent `platform-k3s-test` VM that it never deletes, so reruns skip VM/Istio/cert-manager/Keycloak provisioning. Running `mise run e2e` nukes that VM (shared name); the next `e2e:loop` bootstraps a fresh one. `e2e:loop` does not heal a wedged cluster — if the warm cluster is broken, it fails loud; use `mise run e2e` or `cluster:fix-certs`. Use `e2e:loop` for iteration, `e2e` after helm/realm/infra changes.

**Suite tiers.** **Smoke** (`src/tests/smoke/`) is the always-on tier — CI (in both lanes, see [vm backend](#vm-backend-kvm-only)) and plain `e2e` / `e2e:loop` run exactly it. **Full** = smoke plus the slow, scenario-heavy specs under `src/tests/full/`, run on demand only: `mise run e2e:loop -- --full` (or `mise run e2e -- --full` for the fresh-cluster path). Conventions for `src/tests/full/` specs: one `<area>-full` Playwright project per area, self-contained (own agents, own token via `getAccessToken` + `acceptTerms`, no smoke-chain fixtures), each spec references its motivating ticket in the test title.

## vm backend (KVM only)

On a Mac, `cluster:install --set=virtualization.enabled=true` runs vm agents on one runner on the Mac's own hypervisor, outside the cluster ([host runner](../../../docs/architecture/vm-host-runner.md)): `cluster:host-runner` rebuilds and restarts it (after a reboot too), its log is `~/.local/state/platform-vm-runner/runner.log`, and `PLATFORM_NESTED_VIRT=1` picks the runner pods instead. Everywhere else, and in the e2e lane, the vm backend needs a usable `/dev/kvm` on the k3s node: nested virtualization in the lima VM (Apple silicon M3+, macOS 15+), or a KVM host in sandbox mode. `E2E_VIRTUALIZATION=1 mise run e2e` (or `e2e:loop` bootstrapping a fresh test VM) installs with `virtualization.enabled=true` — values-local.yaml then turns on the chart's KVM device plugin and the runner's `egressCidrs` — stages the mock image for the VM runners, and runs the smoke suite with every agent on the vm Backend ([`src/lib/lane.ts`](../../../packages/e2e/playwright/src/lib/lane.ts)). The auth project's last test opts the e2e user into the `vm-sandboxes` experiment, so the agents the UI creates are machines, and the specs' API creates go through `onLaneBackend` (`src/lib/backend.ts`), which asks for vm. Without the variable the same test turns the experiment off. The first vm boot creates the owner's VM runner, so boot waits scale with `bootTimeoutMs`. A vm run fails, rather than skips, against an install without the backend.

Two specs are tied to a Backend. `smoke/19-agent-backend.spec.ts` (boot and chat, a file in HOME, a schedule fire, hibernate/wake, the restart verb, and the host pod deleted, each keeping HOME) runs on the lane's Backend; on vm its host pod is the owner's whole VM runner, which also runs every other agent of the e2e user, so there it runs after the rest of the suite. `smoke/20-runtime-migration.spec.ts` exists only in a vm run, the one install with both Backends, and runs last: it creates a container agent with a HOME file and a Session, checks that the Migrate button is absent with the experiment off, turns the experiment on, migrates through the button, and checks that the agent keeps its id, HOME and Sessions and still chats. It turns the experiment off and on again, which is why nothing else may run beside it.

CI runs the smoke suite as two lanes on every run but a tag: `mise e2e (container)` (cd.yml's `e2e` job) and `mise e2e (vm)` (`e2e-vm`, the same steps through YAML anchors, plus `E2E_VIRTUALIZATION=1`), each on its own GitHub-hosted x64 runner. The vm lane's runner exposes `/dev/kvm`, which a udev rule opens to the runner user, and builds or pulls the vm-runner beside the other images. A failure in the vm lane alone is the vm Backend's.

In a vm install, `cluster:install` stages the vm images beside the chart install, as soon as the agent images are loaded, not after the deployments are ready. `e2e:install` gives the vm lane's mock agents a 1Gi Size instead of the 2Gi default: each runner's memory request follows its running machines' Sizes plus a 512Mi reserve, and the 16 GB CI node has little room beside the control plane. The vm lane's job summary shows where its time went: with `E2E_TIMINGS=<file>`, `cluster:install`, `e2e:install` and `e2e:run` append phase marks to it (`e2e_mark` in `.mise/lib/cluster.sh`), and `.mise/tasks/e2e/timings` renders them as Markdown, with the per-project spans from the Playwright JSON report that `E2E_REPORT_JSON` names.

## Disk space (the k3s VM)

No image build uses a container runtime, on the host or in the VM. Each `:oci` task writes a tar to its package's
`dist/oci/`, and `cluster:import` copies it into the k3s VM (`platform-k3s`, 200 GiB per
`etc/lima/k3s.yaml`) for `k3s ctr images import`. On macOS the images that need Linux —
the agent images and the VM runner — also build inside that VM, so its one disk holds
their build caches beside the cluster's containerd.

**Symptom.** An image build or import fails with `no space left on device` while the Mac
still reports plenty free. The full disk is the VM's; `df -h /` on the host is about the
wrong filesystem:

```
mise run cluster:shell -- df -h /
mise run cluster:shell -- sh -c 'du -sh ~/.cache/platform-agent-oci ~/.cache/platform-vm-runner'
```

**Reclaim.** `mise run cluster:prune` removes dangling k3s images and leftover import
tars. Inside the VM, the agent build's re-owned layer cache (`~/.cache/platform-agent-oci/owned`)
and the VM runner's cargo target (`~/.cache/platform-vm-runner/target`) only grow; removing
either costs the next build its warm start. Growing the VM's disk is the other lever.
On the host, `~/.cache/platform-image-pack` keeps every base `image:pack` has used, one
per pin, and a bumped pin leaves the old one there until you remove it.

## Cluster debugging (pre-approved in .claude/settings.json)

Use `mise run cluster:kubectl -- <args>` and `mise run cluster:shell -- <cmd>` instead of raw `kubectl` or `export KUBECONFIG=...`. These are auto-approved.

Activate cluster environment for interactive use: `export KUBECONFIG="$(mise run cluster:kubeconfig)"`.

If in-mesh traffic misbehaves — the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step with a misleading `Connection reset`, or a new agent never seeds its workspace (agent pod logs repeat `[runtime] hello failed`) — suspect expired Istio ambient workload SVIDs (issue #283). `mise run cluster:status` reports whether the expired-cert signature is present. The `ztunnel-cert-watchdog` CronJob in `istio-system` auto-rolls `ds/ztunnel` and the waypoint deployments within ~10 min when it sees the signature; `mise run cluster:fix-certs` is the manual escape hatch if you can't wait. The same suspend/resume clock skip can expire cert-manager's webhook serving cert (`cluster:install` fails at admission with `failed calling webhook ... certificate has expired`) — `cluster:status` probes for it and `cluster:fix-certs` heals it too.
