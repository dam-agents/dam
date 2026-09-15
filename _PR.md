# feat/smolvm-node — key findings (remove before merge)

## What this branch does

`backend.type: vm` agents no longer run under KubeVirt. They run as persistent
smolvm microVMs inside one **VM runner** pod (renamed from "sandbox node" on
2026-09-15: it is a pod that runs VMs, not a node) — a single-replica
Deployment from `packages/controller/Dockerfile.vm-runner` (Fedora + smolvm +
the `vm-runner` agent) that holds `/dev/kvm` and `/dev/net/tun` as
device-plugin resources and runs as root with NET_ADMIN, not privileged. The
chart ships squat's generic-device-plugin as a DaemonSet
(`virtualization.devicePlugin.enabled`) so any node with /dev/kvm qualifies —
the dev cluster's Kata pool has it (probed: 64 CPU / 252 GiB, vmx) — with
KubeVirt's plugins as the alternative. The controller talks to it over a TLS +
bearer-token machine API through a headless Service. The gateway pair,
credential plane, ACP relay and api-server are unchanged; the api-server dials
`<agent>.<ns>.svc:8080` as before because the agent Service becomes
selector-less with an EndpointSlice pointing at the node pod's IP and the
machine's published port.

Locally, `mise run cluster:install -- --set=virtualization.enabled=true`
creates the k3s Lima VM with nested virtualization and runs the same pod spec
with the same device plugin. On the dev cluster point the plugin and the node
at the Kata pool (nodeSelector/tolerations) and bind the SCC
(`virtualization.node.scc: privileged`).

History: the first cut of this branch was an SSH-provisioned machine outside
the cluster (second Lima VM locally); a KubeVirt-hosted node was ruled out for
local use because Linux KVM on Apple silicon cannot nest a second time
(measured), and a privileged pod was ruled out on blast radius. The
device-plugin pod keeps the same node agent and image.

## Verified locally (Apple M3, lima/vz nested KVM)

- Fresh install from a deleted sandbox VM → provisioner Job → vm agent Ready.
- Restart verb, resize (in-place `machine update`), hibernate/wake, delete —
  workspace file survives all of them.
- Guest: root, dockerd up on first boot, `/home/agent` on the persistent disk,
  direct internet blocked, gateway reachable through the proxy (egress
  approvals stall a `docker pull`, as for pods).
- Timings here: first boot 7–12 min (smolvm unpacks the image inside the guest;
  nested KVM is slow), restart ~1 min, hibernate stop 3–4 s, wake ~1 min.

## Findings that shaped the design

- **smolvm containerd shim is not viable** (spiked on arm64 k3s): PVCs and
  hostPaths map to guest-internal disks, nothing an agent writes persists;
  containerd ≥ 2.3 is broken upstream (#889).
- **smolvm `serve` (REST, the Go-usable "SDK") was tried and reverted.** It
  accepts only registry references as machine images (`docker save` archives,
  `local:<sha>` and non-SMOLPACK `from` are all rejected), has no update
  endpoint (only disk `resize`), and its machine DB is separate from the CLI's.
  A registry-less dev cluster would need a loopback registry plus `pack
  create`; `pack` bakes in a fixed 4 CPU / 8 GiB TSI VM and smolvm's 30 s
  agent-ready timeout is missed by any guest ≥ 4 GiB under nested KVM, so
  packing on the dev node is impossible. Plain-HTTP registries are allowed for
  loopback hosts only and the in-guest puller (reqwest + webpki roots) cannot
  trust a private CA. The CLI takes an archive directly and can resize in
  place, so the node stays on the CLI.
- **Capabilities:** measured with a capability bounding set — smolvm runs a
  machine with virtio-net and working guest egress under the default container
  caps plus NET_ADMIN; no SYS_ADMIN, no privileged. KVM and tun come as device
  grants.
- **Memory:** smolvm machines negotiate virtio-balloon free-page reporting;
  `--mem` is a cap, the host commits only touched pages and got 1.5 GiB back
  within ~50 s of the guest freeing it. Guest page cache stays until the guest
  drops it.
- **smolvm quirks:** `-p` binds 127.0.0.1 only (vm-runner forwards
  `0.0.0.0:P` → `127.0.0.1:P+1000` with a source allow-list); archives must be
  world-readable (per-VM uid 2000000+); the guest image flattener rejects
  absolute-target symlinks under `/usr/local/bin` (k3s' bundled iptables goes
  on PATH instead); `--net-backend virtio-net` is required (TSI has no default
  route for k3s); dockerd's containerd child misses its 15 s start deadline on
  a slow first boot (the guest boot retries it).
- **Benchmarks (rits bare metal, 4 vCPU/8 GiB):** smolvm is native-speed for
  guest-local fs/exec and boots in ~2 s; its virtiofs host mount is ~7× slower
  than native on small-file work (11.2 s vs 1.5 s for 20k files), which is why
  the workspace lives on the machine's own disk. gVisor cannot run an inner
  k3s (no `/dev/kmsg`, cAdvisor rootfs); smolvm can (node Ready in ~15 s).

## Verified locally as a pod (k3s in lima, nested KVM, 2026-09-14)

- Device plugin advertises `squat.ai/kvm|tun`, the node pod schedules on it,
  smolvm sees /dev/kvm; controller → node API over TLS works; the agent
  Service's EndpointSlice carries the pod IP + machine port; a node pod
  restart keeps the machine disks and the loaded image archive (PVC).
- **AppArmor:** containerd's default profile (`cri-containerd.apparmor.d`)
  makes every libkrun guest exit before its kernel prints a line. The node
  container is `appArmorProfile: Unconfined`; its capability set is the gate.
- **smolvm's 30 s agent-ready ceiling is hard** in 1.16 (no flag or env on
  `machine start`; `--ready-timeout` exists only for branching). Under lima's
  nested KVM a guest reaches the agent in 10–20 s on a quiet host and misses
  the ceiling on a busy one, and boot time grows with guest RAM (measured
  late on 2026-09-14: 2.6 s to the agent at 512 MiB, 20 s at 1.5 GiB, 25 s at
  2 GiB — guest pages the Mac has not backed yet fault in slowly under nested
  KVM), so first boots are flaky locally and a 4 GiB machine never makes it;
  on bare metal
  the guest is up in ~2 s. When smolvm gives up it leaves the guest process
  running (100 % CPU, still booting) — vm-runner now kills that orphan
  after a failed start, and catatonit reaps the zombies (vm-runner was
  PID 1). Each retry is a fresh boot; the controller's 3 s requeue drives it.
- **Unclean stops** (a node pod restart kills every guest): smolvm then reports
  the machine `unreachable` until a `machine stop` recovers it, and the root
  overlay (`overlay.qcow2`, the throwaway root layer — the flattened image
  and the workspace live on `storage.raw`) comes back dirty, which makes the
  next boot exit with code 1 before the kernel prints anything. vm-runner
  now stops, clears the stale sockets/lock/pid and the overlay before every
  start; with that, a machine killed with its pod comes back in ~40 s.
- First boot of the 760 MB vm image flattens it inside the guest (~20 min
  under nested virt); later boots find it on the storage disk.

## End-to-end through the UI (2026-09-15 night)

- Container path: login dev/dev, add the IBM LiteLLM provider key in
  Settings → Providers, create a Claude Code agent, send "ping" → "pong" in
  40 s. Works.
- VM path: a Claude Code VM agent created the same way reaches Ready and the
  api-server reaches it, but the "ping" turn is marked "Not delivered" — the
  UI gives up after `DELIVERY_TIMEOUT_MS` (60 s) without an ACP update, and a
  1-vCPU nested guest takes minutes for Claude Code's first turn (the model
  call did go out through the gateway). Not reproduced on bare metal. Later in
  the night the Mac was swapping (5 GiB) and no 760 MB vm image booted inside
  smolvm's 30 s window any more, while a 5 MB alpine guest still did in 6 s —
  so the second and third VM agents never came up. The `vm-sandboxes` feature
  flag is revealed by tapping the version label five times in Settings.

## VM ping → pong through the UI (2026-09-15)

With the unified image: create "Claude Code VM" in the UI (LiteLLM provider
selected), size 1 vCPU / 1 GiB, Ready in 351 s (the 367 MB archive flattens
in-guest), "ping" answered "pong" in 86 s, zero vm-runner errors. So the
"Not delivered" turns seen the night before were the old vm image (built on a
registry claude-code base) plus the 2 GiB boot ceiling, not the relay.

## One image family (2026-09-15)

The separate `claude-code-vm` image is gone. The vm template boots the plain
`claude-code` image: the persistence prelude (bind-mount the persisted paths
from the `/workspace` storage disk) moved into `platform-base`'s entrypoint,
where it is a no-op for containers, and docker + k3s inside the guest are
dropped for now (DAM-in-DAM is a follow-up — likely a shared read-only tools
volume on the runner rather than 300 MB in every image). Any template can now
be run as a VM by setting `backend.type: vm`.

## Review round (2026-09-15, three Opus reviewers)

Fixed: guest ports and the machine API were reachable from any pod (proved on
the local cluster) — a NetworkPolicy now admits only the api-server and the
controller; a running-but-dead machine (guest gone, smolvm still says running)
is restarted after 2 min unhealthy once it had been healthy; a DELETE racing an
in-flight create no longer resurrects the machine; image/egress-list changes
are reported as an error instead of being silently ignored; `smolvm machine
status` failures no longer read as "absent" (which re-ran create); machines
whose Agent is gone are swept with the PVC/Secret orphan sweep (`GET
/machines`); EndpointSlice readiness follows the machine; the runner
credentials get checksum annotations on both pods and `resource-policy: keep`
(so a lookup-less render cannot desync them silently), the PVC is kept on
uninstall, the device plugin is pinned by digest and gets its own SCC value and
the runner's placement by default; values-local had put `userBudgets` under
`virtualization` (fixed); `cluster:install` deduped the shared claude-code
image away from the vm load step (fixed); the persistence prelude refuses to
boot when `/workspace` is not a mount; runner image on Fedora 42.

Re-verified after the fixes: the VM runner pod was recreated with every agent's
machine on the kept PVC, the controller brought that machine back by itself
(smolvm reports the machine unreachable, the runner recovers and starts it),
the agent went Ready and answered ping → pong in the UI; from an unrelated pod
both the machine API and a guest's published port are refused, while the
api-server still connects.

Re-verified after the second round (2026-09-15): fresh images, one deploy, one
new VM agent created in the UI — Ready in 823 s (the first boot flattens the
image in-guest), zero runner errors, and in the guest `/workspace` is the
storage disk with the persisted paths bind-mounted from it, which is the
rewritten prelude guard working on a real boot. The chat turn could not be
re-checked in that window: the IBM LiteLLM endpoint became unreachable from
both the cluster and the host (a container agent created at the same moment
answers "API Error: 503 … connection timeout", and `GET /v1/models` times out
from the api-server pod and from the Mac). The ping → pong recorded above was
on the pre-review build, and the model calls the VM agent did make went out
through its gateway exactly as the container's did.

Third round (2026-09-15, JP's calls): the guest stays root — the VM is the
boundary, smolvm already runs each machine under its own host uid, and the
docker/k3s follow-up needs it (IS_SANDBOX=1 is set, so Claude Code runs).
Implemented from the "not fixed" list:
- the runner admits a machine only if its memory fits what is left, counting
  the machines already running and keeping `reserveMiB` for itself; its own
  ceiling comes from the pod's memory limit through the downward API
- it counts the restarts it performs on a guest that stopped answering, and
  the controller publishes that count, so a rebooted guest is distinguishable
  from a slow start (invocation liveness reads it)
- it names why a machine is not ready (MachineBootFailed,
  MachineImageUnavailable, MachineOutOfCapacity, MachineNotReady) and the
  api-server treats the first three as failures with their own copy instead
  of retrying a "still starting" agent forever

Still open: `dam ssh` logs in as `agent` while the guest runs as root, so the
session lands on a uid that cannot write its own home — the fix is for the
runtime to advertise its user and the CLI to honour it.

Documented, not fixed: one runner pod hosts every user's machine (cross-tenant
blast radius, per-tenant runner is the upgrade path); secrets travel on the
smolvm argv inside the runner pod; the runner has no resource limits unless
set; smolvm is installed by its remote installer at image build.

## Known gaps (also in ADR 091)

- A template image change does not reach an existing machine (image is fixed
  per machine; the workspace lives on that machine's disk).
- Agent pull secrets are not forwarded; private registries need credentials in
  smolvm's settings on the node.
- Budgets count a vm agent by its gateway StatefulSet; per-user fair-use
  limits for machines are a follow-up, as is more than one node.
- `check:crd-backwards-compatibility` fails in a git worktree (go-git cannot
  resolve tags through the worktree gitdir); it is unrelated to this change.
