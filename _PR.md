# feat/smolvm-node — key findings (remove before merge)

## What this branch does

`backend.type: vm` agents no longer run under KubeVirt. They run as persistent
smolvm microVMs inside one **sandbox node** pod — a single-replica Deployment
from `packages/controller/Dockerfile.sandbox-node` (Fedora + smolvm + the
`sandbox-node` agent) that holds `/dev/kvm` and `/dev/net/tun` as
device-plugin resources (KubeVirt's, by default) and runs as root with
NET_ADMIN, not privileged. The controller talks to it over a TLS +
bearer-token machine API through a headless Service. The gateway pair,
credential plane, ACP relay and api-server are unchanged; the api-server dials
`<agent>.<ns>.svc:8080` as before because the agent Service becomes
selector-less with an EndpointSlice pointing at the node pod's IP and the
machine's published port.

Locally, `mise run cluster:install -- --set=virtualization.enabled=true`
creates the k3s Lima VM with nested virtualization and runs the same image
privileged (no device plugin in k3s). On the dev cluster the pod needs the
virt nodes' toleration and an SCC binding (`virtualization.node.scc:
privileged`).

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
- **smolvm quirks:** `-p` binds 127.0.0.1 only (sandbox-node forwards
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

## Known gaps (also in ADR 091)

- A template image change does not reach an existing machine (image is fixed
  per machine; the workspace lives on that machine's disk).
- Agent pull secrets are not forwarded; private registries need credentials in
  smolvm's settings on the node.
- Budgets count a vm agent by its gateway StatefulSet; per-user fair-use
  limits for machines are a follow-up, as is more than one node.
- `check:crd-backwards-compatibility` fails in a git worktree (go-git cannot
  resolve tags through the worktree gitdir); it is unrelated to this change.
