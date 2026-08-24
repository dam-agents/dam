---
name: cluster-ops
description: Operate the local k3s dev cluster (lima) and the Playwright e2e suite, and recover from mesh/cert failures. Use when working with the local cluster, running or debugging e2e tests, or when any of these symptoms appear - the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step or fails at a webhook admission with an expired certificate, an agent pod repeats `[runtime] hello failed`, `e2e:loop` fails against a warm cluster, or an image build dies with `no space left on device` while the host disk still has room. Triggers on "cluster:install", "cluster:status", "e2e:loop", "fix-certs", "cluster:prune", "lima", "k3s", "colima", "ztunnel", "waypoint", "Istio SVID", "no space left on device", "issue #283".
---

# Cluster operations

## Cluster lifecycle (k3s via lima)

`mise tasks` lists every `cluster:*` task with its description. The ones you'll reach for most:

- `cluster:install` — create the k3s VM, build images, install cert-manager + the Platform chart (upgrades in place if already installed)
- `cluster:build-apiserver` / `build-ui` / `build-controller` / `build-agent` / `build-keycloak` — rebuild one image and restart just that pod
- `cluster:status` — pods and cluster state
- `cluster:logs` — api-server pod logs
- `cluster:fix-certs` — recover from expired dev-cluster certs (see below)
- `cluster:stop` / `cluster:uninstall` / `cluster:delete`

The `cluster:build-*`, `cluster:fix-certs`, and `cluster:status` tasks honor a `LIMA_INSTANCE` env var (default `platform-k3s`); set it to target a different VM (e.g. the e2e cluster).

Services are available at `*.localhost:4444` automatically (Traefik on port 4444, auto-forwarded by lima). `*.localtest.me:4444` also works as an alias.

## E2E tests (Playwright)

- `mise run e2e` — full from-scratch run: nuke the test VM, install a fresh cluster, run specs, tear down (the CI path)
- `mise run e2e:loop` — fast rerun against a warm test cluster: bootstrap once if missing, optionally rebuild components, wipe data, run specs. Options: `--headed --rebuild=apiserver,ui,controller,keycloak,mock-agent`
- `mise run e2e:reset` — data wipe only: drop+recreate the platform DB, delete agents (CMs/sts/pods/PVCs), clear stored Playwright auth. Leaves the cluster running

`e2e:loop` runs on a dedicated persistent `platform-k3s-test` VM that it never deletes, so reruns skip VM/Istio/cert-manager/Keycloak provisioning. Running `mise run e2e` nukes that VM (shared name); the next `e2e:loop` bootstraps a fresh one. `e2e:loop` does not heal a wedged cluster — if the warm cluster is broken, it fails loud; use `mise run e2e` or `cluster:fix-certs`. Use `e2e:loop` for iteration, `e2e` after helm/realm/infra changes.

**Suite tiers.** **Smoke** (`src/tests/smoke/`) is the always-on tier — CI and plain `e2e` / `e2e:loop` run exactly it. **Full** = smoke plus the slow, scenario-heavy specs under `src/tests/full/`, run on demand only: `mise run e2e:loop -- --full` (or `mise run e2e -- --full` for the fresh-cluster path). Conventions for `src/tests/full/` specs: one `<area>-full` Playwright project per area, self-contained (own agents, own token via `getAccessToken` + `acceptTerms`, no smoke-chain fixtures), each spec references its motivating ticket in the test title.

## Disk space (two independent VMs)

Local dev spans **two** VMs with separate, fixed-size virtual disks that cannot see each
other's filesystems:

- the **docker daemon VM** (colima, or Docker Desktop) — builds the images; holds the
  buildkit cache and the local `platform-*:latest` tags
- the **k3s VM** (`platform-k3s`, 200 GiB per `deploy/lima-k3s.yaml`) — runs the cluster
  and has its **own** containerd

Images cross the gap by copy, not by mount: `docker save` to a tar, `limactl copy` into
the guest, `k3s ctr images import`. So every image is stored on both disks, and neither
`docker system prune` nor a cluster-side prune helps the other side.

**Symptom.** An image build fails with `no space left on device` (often mid-`unpacking`,
naming a path under `/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs`) while
the Mac still reports plenty free. The full disk is the **docker daemon VM's**, not the
host's and not the cluster's. Check the daemon's own view — `df -h /` on the host is
about the wrong filesystem:

```
docker system df                      # images + build cache; build cache is usually the bulk
colima ssh -- df -h /                 # the daemon VM's actual disk (if using colima)
```

**Reclaim.** `mise run cluster:prune` prunes both sides: buildkit cache (capped, default
`--keep=10GB`), dangling docker images, dangling k3s images, and leftover import tars.

**Prevent.** Buildkit's default policy keeps cache until the disk is nearly full, which on
a fixed-size VM disk shows up as a mid-build ENOSPC instead of a clean eviction. Cap it
once in the daemon config so it can never fill the disk. For colima, in
`~/.colima/default/colima.yaml` (survives restarts, then `colima restart`):

```yaml
docker:
  builder:
    gc:
      enabled: true
      defaultKeepStorage: "20GB"
```

Docker Desktop has the same setting under Settings → Builders → disk usage limit. Growing
the VM disk is the other lever (`colima stop && colima start --disk 200`) — colima can
grow but never shrink it, and the image is sparse, so it needs real host space to expand
into.

## Cluster debugging (pre-approved in .claude/settings.json)

Use `mise run cluster:kubectl -- <args>` and `mise run cluster:shell -- <cmd>` instead of raw `kubectl` or `export KUBECONFIG=...`. These are auto-approved.

Activate cluster environment for interactive use: `export KUBECONFIG="$(mise run cluster:kubeconfig)"`.

If in-mesh traffic misbehaves — the UI suddenly can't log in, `cluster:install` hangs on the keycloak realm step with a misleading `Connection reset`, or a new agent never seeds its workspace (agent pod logs repeat `[runtime] hello failed`) — suspect expired Istio ambient workload SVIDs (issue #283). `mise run cluster:status` reports whether the expired-cert signature is present. The `ztunnel-cert-watchdog` CronJob in `istio-system` auto-rolls `ds/ztunnel` and the waypoint deployments within ~10 min when it sees the signature; `mise run cluster:fix-certs` is the manual escape hatch if you can't wait. The same suspend/resume clock skip can expire cert-manager's webhook serving cert (`cluster:install` fails at admission with `failed calling webhook ... certificate has expired`) — `cluster:status` probes for it and `cluster:fix-certs` heals it too.
