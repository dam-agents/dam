# Full-VM sandboxes (KubeVirt) — architecture proposal

Status: proposal, 2026-07-27 — decisions below resolved in a grilling session
with JP; open items are marked.

## Goal

Add an advanced per-template option to run an agent sandbox as a **full virtual
machine** (KubeVirt `VirtualMachine`) instead of a Kata pod, so workloads that
need a real machine — systemd, docker, nested containers, and above all **k3s
with full Kubernetes workloads** — run *inside the sandbox itself*. This
replaces dam-vm, which is **deleted in the same change set** (it is deployed on
the dev cluster only; consequences handled manually — no migration tooling, no
coexistence window). Most sandboxes stay Kata pods; the VM backend is opt-in.

## Why this fits the existing shape

1. **The VM still lives inside a pod.** KubeVirt runs each VM in a
   `virt-launcher` pod whose network namespace carries all the VM's traffic
   (masquerade interface). Labels declared on `vm.spec.template.metadata`
   land on that pod. So the per-pair egress NetworkPolicy, the
   `agent-ingress-platform-only` policy, the `istio.io/dataplane-mode: none`
   ambient opt-out, the pod informer selector, and the headless agent Service
   keep working **unchanged**. The kernel-level "only route is the paired
   gateway" invariant holds for every byte the VM emits, including traffic
   from k3s pods nested inside the guest.
2. **The gateway pair is untouched.** Credential injection, ext_authz/HITL,
   SPIFFE identity, `l7Hosts` — all hang off the gateway pod, which stays a
   plain StatefulSet. The backend kind is invisible to the credential plane.
3. **Configuration already avoids the pod spec.** User/template/connection
   env and file fragments ride the runtime channel — only the small static
   platform block needs cloud-init delivery.

## Resolved design

### Spec surface: `backend` (decided)

```yaml
backend:
  type: vm            # container | vm, default container
  vm: {}              # variant props in a sub-block named after the variant
```

- K8s discriminated-union convention (like volume sources / HPA metrics);
  CEL enforces `vm` block present iff `type: vm`.
- CRD defaults `backend: {type: container}` so stored Agents stay valid;
  one schema-generation bump for the whole addition.
- `runtimeClassName` / `nodeSelector` (ADR-073) **stay top-level** — moving
  fields breaks stored CRs. `nodeSelector` applies to both backends (KubeVirt
  propagates it to virt-launcher); `runtimeClassName` + `type: vm` is
  **rejected at admission** (CEL), not silently ignored.
- "Backend" is recorded in `docs/ubiquitous-language.md` — deliberately not
  "Sandbox", which is the retired user-facing-name-for-Agent term (#892).
- Backend is create-time-immutable, like mounts.

### Controller: a sibling builder, per-kind seams

`BuildAgentStatefulSet` (resources.go:104) gets a sibling
`BuildAgentVirtualMachine` with the same signature; the reconciler branches at
the single call site (agent_reconciler.go:292). The VM object:

- **Labels** — `LabelAgent`/`LabelPair`/`LabelRole=agent` +
  `istio.io/dataplane-mode: none` on `spec.template.metadata` → propagate to
  the virt-launcher pod.
- **Networking** — single masquerade interface on the pod network; the pod
  netns is the enforcement point. No Multus.
- **Boot disk** — a `containerDisk`; rootfs writes are ephemeral,
  deliberately matching the pod model's hibernate contract.
  `imagePullSecrets` cover containerDisk pulls (kubelet-side — the pull
  credential never enters anything agent-controlled).
- **Workspace** — each `persist: true` mount stays the same RWX filesystem
  PVC, attached via **virtiofs** (`domain.devices.filesystems`), mounted by
  baked systemd units. Warm pool, orphan sweep, and controller PVC deletion
  are unchanged. (Live migration is incompatible with virtiofs — irrelevant,
  hibernation is a shutdown. Virtiofs support in the target OpenShift
  Virtualization version is a **spike item**; if unavailable the fallback is
  block-disk workspaces, which would be a real design change.)
- **Scratch** — rootfs overlay + docker/k3s image stores live on an
  emptyDir-backed scratch sized by a **global chart knob**
  (`virtualization.scratchGi`, default 30) — not per-VM (decided). It is
  ephemeral-storage on the virt-launcher pod: no storage-class dependency,
  no block-mode requirement in dev; the accepted cost is that node-pressure
  eviction kills the VM like a hibernate would.
- **Platform config** — controller-rendered per-agent cloud-init Secret
  (`cloudInitNoCloud.secretRef`): platform env block, MITM CA into the guest
  trust store, boot gate below. Replaces pod `env` / `envFrom` /
  `/etc/platform/ca` projection.
- **Lifecycle** — `shouldRun` flips `runStrategy: Always ⇄ Halted` instead of
  replicas 1 ⇄ 0; `scaleAgentPairToZero` becomes kind-aware for the mixed
  pair (VM agent + StatefulSet gateway). Roll-restart becomes explicit
  stop/start.
- **Readiness** — per-kind accessor replacing the `-0` pod lookup +
  `controller-revision-hash` check: VMI `Ready` + KubeVirt readiness probe on
  `:8080/healthz` (agent-runtime in the guest), template-revision staleness
  via a controller-stamped annotation, VM-shaped failure causes
  (unschedulable — no `/dev/kvm` node, containerDisk pull failure, guest boot
  hang) feeding the typed wake-failure classification.
- **Boot gate (np-gate analogue)** — first-boot systemd unit ordered before
  agent-runtime: wait until the kube-apiserver is unreachable AND the paired
  gateway health endpoint answers. Same fail-closed semantics in-guest; only
  platform-baked code runs at that point. In-guest iptables lockdown is baked
  defense-in-depth; the NetworkPolicy on virt-launcher stays authoritative.
- **Budgets/resources (decided)** — `spec.resources.limits` maps 1:1 onto
  guest CPU/memory with requests forced equal (CEL) — honest about full
  reservation. No VM-specific budget dimension: a VM agent simply costs more
  of the same reserved-compute currency. The budget gate (budget.go) gets a
  per-kind accessor. The `claude-code-vm` template inherits the **platform
  default resource shape** for now — bump the template later if k3s is
  cramped.

### api-server: two addressing sites, nothing else

`modules/agents/infrastructure/k8s.ts:212` (`<id>-0.<id>.<ns>.svc:8080`) and
`core/acp-client.ts:298` (`ws://<podIP>:8080`) switch to the headless agent
Service DNS, as does the controller busy probe (idlechecker.go:141). All other
surfaces (ACP relay, terminal, SSH, file import, skills tRPC, runtime channel,
pod service) terminate at agent-runtime inside the guest and work unchanged.
`dam-run` and forks are **rejected with a typed error** on VM agents (decided
— see gaps).

### VM image (decided)

**v1 ships exactly one VM template: `claude-code-vm`** — Fedora 44 bootc
base, **moby-engine + docker CLI and k3s preinstalled** (hibernation wipes the
rootfs; rebuild-on-wake only works if binaries are baked).

- Build-time reuse, never runtime composition: the bootc Containerfile
  consumes the existing agent OCI image (`FROM <bootc-base>` +
  `COPY --from=<agent-oci>`), so the OCI image stays the single source of
  harness truth. Whether `COPY --from` transplants cleanly or the build
  re-runs shared install scripts is the **first spike**. Runtime alternatives
  (guest pulls/overlays the OCI image at boot) were rejected: they break the
  image-pull credential boundary, re-pull GBs every wake, and land the agent
  back inside a container.
- `bootc-image-builder` (privileged, loop devices) emits the qcow2, wrapped
  as a containerDisk OCI image. **Caching (decided):** the mise task keys on
  a hash of the build inputs (bootc Containerfile + source OCI image digest)
  and skips the qcow2 step when the output for that hash already exists —
  most iteration touches only the OCI layer. This pipeline is the item to
  spike first; the feature queues behind it.
- `spec.image` on a VM backend **is** the containerDisk reference — one
  string, so the template-upgrade path ("image reference doubles as template
  version identity") is untouched.
- Baked guest plumbing: system-wide proxy env at the gateway, MITM CA in the
  OS trust store, containerd/dockerd/k3s **registry mirror config pointing at
  the pull-through cache** (below), virtiofs mount units, boot gate,
  qemu-guest-agent, sshd.
- Custom user images: allowed, same rule as custom pod images — any image,
  but it must ship the platform contract (agent-runtime, harness scripts,
  guest plumbing).

### Pull-through registry cache (decided; replaces the data disk)

Adopted from studying Locki (github.com/janpokorny/locki), which runs a
shared nginx pull-through cache + shared buildkitd for its sandboxes:

- **Take the cache.** A chart-bundled, opt-in platform service
  (SeaweedFS-style precedent): TLS-terminates well-known public registry
  hosts, caches blobs **content-addressed by digest** (multi-tenant-safe —
  poisoning requires breaking sha256), caches manifests only at digest URLs
  (tags stay uncached), **anonymous-only** upstream fetches with
  `Authorization` stripped — private-image pulls keep going the normal gated
  route. It joins the harness path and object store as the third
  **platform-internal upstream** the gateway forwards without per-request
  HITL. Guest container runtimes point at it via baked mirror config. This
  solves both wake-time image re-pull cost (LAN-speed refill, shared across
  agents) and HITL noise from k3s pulls. Recorded caveat: it is a deliberate
  egress carve-out — un-gated *read* access to public registries (a
  low-bandwidth covert channel via pull patterns, comparable to DNS); opt-in
  per chart, traffic in the security log.
- **Refuse the shared BuildKit.** `RUN` steps execute arbitrary tenant code
  in the daemon — a cross-tenant shared trust domain, exactly the dam-vm
  weakness this feature retires. Locki can share it because all its sandboxes
  are one user. Builds happen inside each VM's own dockerd.
- **Consequence: no persistent data disk in v1.** k3s cluster state and
  docker caches die with hibernation (matching dam-vm's own ephemerality);
  rebuild-on-wake is fast against the warm cache. A block-PVC data disk
  (`/var/lib/docker` + `/var/lib/rancher`) stays a documented follow-up if
  real usage demands cluster-state persistence.

### Hibernation (decided)

- **Cluster default timeout (30 min), no template seed.** VMs are for dev
  work; no running dev turn = OK to reclaim. The idle checker's busy probe
  already keeps a VM awake while a harness turn is in flight with nobody
  attached (agent-lifecycle.md names that exact case) — only turn-less k3s
  workloads are reclaimed, which is accepted policy.
- VM sandbox settings carry **warning copy**: hibernation discards the k3s
  cluster and in-VM services.
- The busy probe returns "not busy" on any error (idlechecker.go:139) — the
  e2e full tier must cover "turn in flight survives an idle-checker pass on a
  VM agent" so a probe-address regression can't silently hibernate mid-turn.
- An explicit agent-callable keep-awake lease (bounded, visible, expiring)
  was considered and **deferred as a separate, backend-agnostic follow-up
  issue** — no process/cluster sniffing from agent-runtime, per the
  lifecycle doc's reasoning.

### Chart / operator surface (decided)

- `virtualization.enabled: false` gates: controller RBAC for `kubevirt.io`
  (VirtualMachines/VMIs — **no CDI**, containerDisk-only), api-server
  admission of `backend.type: vm`, and `claude-code-vm` catalog visibility.
- `agents.vmBase.{nodeSelector, tolerations, …}` — chart-wide VM placement
  block mirroring the container base (ADR-043/073 split); per-template
  `nodeSelector` wins on merge. Prod values carry the
  `node-role.kubernetes.io/virtualization` selector + toleration. The
  gateway pod does **not** inherit `vmBase`.
- `virtualization.scratchGi: 30` — global guest scratch size (see above).

### Local dev / e2e (decided)

OpenShift Virtualization is productized KubeVirt; the API subset we consume
(`kubevirt.io/v1`, containerDisk, virtiofs, masquerade, cloudInitNoCloud,
probes, runStrategy) is core upstream, and upstream KubeVirt installs on k3s:

- `cluster:install` gains an opt-in KubeVirt step that probes `/dev/kvm` in
  the lima VM and sets `developerConfiguration.useEmulation` accordingly.
  lima `vz` + `nestedVirtualization: true` gives real KVM on M3+/macOS 15
  (and Linux hosts); M2 machines run TCG emulation — correct but slow
  (~1–3 min boots), functional for e2e.
- VM specs live in the **full tier only** (`sandbox-vm-full` project under
  `src/tests/full/`) — never smoke; TCG boot latency would wreck the smoke
  budget.

## Accepted feature gaps (v1)

1. **No `dam-run`, no forks (Slack foreign repliers) on VM agents** — both
   materialize `spec.image` as a pod container, impossible for a
   containerDisk. Rejected with typed errors at the api-server. Shared-mode
   channel bindings still work (they relay to the main pod). The
   dual-artifact template (containerDisk + paired OCI image) is deferred
   until someone actually needs foreign repliers on a VM agent.
2. **k3s cluster state dies on hibernate** — see the cache/data-disk
   decision. dam-vm-equivalent semantics, deliberately.
3. **Restart-required resize** — no CPU/memory hotplug in v1.
4. **The container-agent + occasional-VM hybrid dies with dam-vm** — a
   workload that wants a machine should *be* a VM agent. The "fleet of cheap
   agents sharing rare VM capability" shape is unserved until it shows up in
   practice.
5. **Slower wake** — VM boot on top of pod scheduling; containerDisk pulls
   are node-cached after first use; ops lever is node-level pre-pull.
6. **Ops delta** — no `kubectl exec` into the guest; `virtctl console` and
   the existing `/api/ssh` relay replace it.

## Spike list (ordered)

1. bootc image build: does `COPY --from=<agent-oci>` transplant the harness
   layer, or do we re-run shared install scripts? qcow2 pipeline + hash-keyed
   caching in mise.
2. virtiofs (`domain.devices.filesystems`) support/feature-gate status in the
   target OpenShift Virtualization version.
3. KubeVirt-on-lima-k3s: `useEmulation` path, boot timing, `nestedVirtualization`
   on M3+.
4. Pull-through cache service: nginx (Locki-style, content-addressed keys) vs
   stock registry proxy; gateway platform-internal-upstream wiring.
