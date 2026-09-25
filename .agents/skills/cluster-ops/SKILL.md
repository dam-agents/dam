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

**Suite tiers.** **Smoke** (`src/tests/smoke/`) is the always-on tier — CI and plain `e2e` / `e2e:loop` run exactly it. **Full** = smoke plus the slow, scenario-heavy specs under `src/tests/full/`, run on demand only: `mise run e2e:loop -- --full` (or `mise run e2e -- --full` for the fresh-cluster path). Conventions for `src/tests/full/` specs: one `<area>-full` Playwright project per area, self-contained (own agents, own token via `getAccessToken` + `acceptTerms`, no smoke-chain fixtures), each spec references its motivating ticket in the test title.

## vm backend (KVM only)

The vm backend needs `/dev/kvm` in the k3s VM (nested virtualization: Apple silicon M3+, macOS 15+), so nothing in CI exercises it live. To test it on a host that has it, `E2E_VIRTUALIZATION=1 mise run e2e` (or `e2e:loop` bootstrapping a fresh test VM) installs with `virtualization.enabled=true` and stages the mock image for the VM runners, which un-skips `smoke/19-vm-agent.spec.ts`. Without it that spec skips itself.

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
