# Full-VM sandboxes (KubeVirt) — architecture proposal

Status: proposal, 2026-07-27

## Goal

Add an advanced per-template option to run an agent sandbox as a **full virtual
machine** (KubeVirt `VirtualMachine`) instead of a Kata pod, so workloads that
need a real machine — systemd, docker, nested containers, and above all **k3s
with full Kubernetes workloads** — run *inside the sandbox itself*. This
retires [dam-vm](../architecture/dam-vm.md): instead of an agent in a Kata pod
reaching out to a side-machine on an external VPS, the agent that needs a
machine *is* the machine. Most sandboxes stay Kata pods; `vm` is opt-in.

## Why this fits the existing shape

Three properties of the current architecture make a KubeVirt swap far cheaper
than it first looks:

1. **The VM still lives inside a pod.** KubeVirt runs each VM in a
   `virt-launcher` pod whose network namespace carries all the VM's traffic
   (masquerade interface). Labels declared on `vm.spec.template.metadata`
   land on that pod. So the per-pair egress NetworkPolicy, the
   `agent-ingress-platform-only` policy, the `istio.io/dataplane-mode: none`
   ambient opt-out, the pod informer selector, and the headless agent Service
   all keep working **unchanged** — they select pod labels, and the
   virt-launcher pod carries them. The kernel-level egress boundary
   ("no route to TCP 80/443 except the paired gateway") holds for every byte
   the VM emits, including traffic from k3s pods nested inside the guest.
2. **The gateway pair is untouched.** Credential injection, ext_authz/HITL,
   SPIFFE identity, `l7Hosts` — all of it hangs off the *gateway* pod, which
   stays a plain StatefulSet. The sandbox kind is invisible to the credential
   plane.
3. **Configuration already avoids the pod spec.** User env, template env,
   connection env, and file fragments ride the runtime channel into
   agent-runtime — never `spec.env` (agent-lifecycle.md). Only the small,
   static platform block (proxy address, agent id, harness URLs, CA cert) is
   pod-spec-delivered today, and that fits in a cloud-init rendering.

## Design

### Spec surface

- `AgentSpec.sandbox: "container" | "vm"` (default `container`), set by the
  template like `runtimeClassName`/`nodeSelector` — the ADR-073 precedent:
  scheduling-class choices are per-template, everything security-shaped stays
  chart-only. Immutable after create (like mounts). CRD schema generation
  bumps 5 → 6.
- Chart gate `virtualization.enabled` (default off): adds controller RBAC for
  `kubevirt.io` resources and admits `sandbox: vm` templates. VM templates
  carry `nodeSelector`/`tolerations` for virtualization-capable nodes
  (`/dev/kvm`), exactly as GPU Kata templates do today.

### Controller: a sibling builder, per-kind seams

`BuildAgentStatefulSet` (resources.go:104) gets a sibling
`BuildAgentVirtualMachine` with the same signature; the reconciler branches at
the single call site (agent_reconciler.go:292). The VM object:

- **Labels** — `LabelAgent`/`LabelPair`/`LabelRole=agent` +
  `istio.io/dataplane-mode: none` on `spec.template.metadata`, so they
  propagate to the virt-launcher pod (see "why this fits").
- **Networking** — single masquerade interface on the pod network. No
  Multus/bridge networking: the pod netns *is* the enforcement point.
- **Boot disk** — a `containerDisk` (ephemeral qcow2 shipped as an OCI
  image). Writes to the rootfs die with the VM — deliberately identical to
  the pod model's ephemeral filesystem, so the hibernate contract
  ("PVC survives, OS-level changes don't") is preserved verbatim.
  `imagePullSecrets` apply to containerDisk pulls, so private-registry VM
  images ride the existing agent-scoped pull-Secret mechanism.
- **Workspace** — each `persist: true` mount stays the same **RWX filesystem
  PVC**, attached to the VM via **virtiofs**
  (`domain.devices.filesystems`) and mounted in the guest by a baked systemd
  mount unit. This preserves, without modification: hibernate/wake
  persistence, warm-pool claiming, orphan-PVC sweeps, controller-side PVC
  deletion, and fork/`dam-run` co-mounting of the same volume from ordinary
  pods. (Live migration is incompatible with virtiofs — irrelevant, we never
  migrate; hibernation is a shutdown.)
- **Platform config** — a controller-rendered per-agent cloud-init Secret
  (`cloudInitNoCloud.secretRef`): the platform env block (gateway ClusterIP
  proxy address, `PLATFORM_AGENT_ID`, harness URLs, `HOME`), the MITM CA
  written into the guest trust store, and the boot-gate below. This replaces
  pod `env`, `envFrom: secretRef`, and the `/etc/platform/ca` projection.
- **Lifecycle mapping** — `shouldRun` flips `runStrategy: Always ⇄ Halted`
  instead of replicas 1 ⇄ 0. `scaleAgentPairToZero` (which lists
  StatefulSets by `LabelAgent`) becomes kind-aware for the mixed pair (VM
  agent + StatefulSet gateway). The roll-restart verb (template-divergence
  roll via `stampRollRev`) becomes an explicit stop/start.
- **Readiness** — the `-0`-ordinal pod lookup, `controller-revision-hash`
  check, and container-termination-reason enrichment
  (agent_reconciler.go:406-424, pod_termination.go) are StatefulSet-shaped.
  Introduce a per-kind readiness accessor: for VMs, VMI `Ready` +
  a KubeVirt readiness probe on `:8080/healthz` (agent-runtime in the
  guest), template-revision staleness via a controller-stamped annotation,
  and VM-specific failure causes (unschedulable — no `/dev/kvm` node,
  containerDisk pull failure, guest boot hang) feeding the existing typed
  wake-failure classification.
- **Boot gate (np-gate analogue)** — the pod model refuses to start the
  workload until the NetworkPolicy is proven in force (np_gate_init.go). The
  VM guest can't be gated by an init container, so the same check moves
  in-guest: a first-boot systemd unit ordered before agent-runtime waits
  until the kube-apiserver is *unreachable* and the paired gateway health
  endpoint answers, then starts the stack — same fail-closed semantics,
  same probe, different host. In-guest iptables lockdown (the
  egress-lockdown analogue) is baked defense-in-depth; the authoritative
  gate remains the NetworkPolicy on virt-launcher.
- **Budgets** — the reserved-compute gate reads limits off
  `Spec.Template.Spec.Containers` and replicas (budget.go); it gains a
  per-kind accessor reading the VM's guest memory/CPU and run strategy.
  Guest memory is *fully reserved* (no overcommit), so VM agents are honest
  but expensive budget citizens.

### api-server: two addressing sites, nothing else

The api-server routes on the controller's `Ready` condition and talks only to
agent-runtime; it never inspects pods — except two places that address the
runtime by StatefulSet pod DNS / pod IP:

- `modules/agents/infrastructure/k8s.ts:212` — `<id>-0.<id>.<ns>.svc:8080`
- `core/acp-client.ts:298` — `ws://<podIP>:8080/api/acp`

Both switch to the headless agent Service DNS (`<id>.<ns>.svc`), which
resolves to the single backing pod for either kind — a simplification that
also removes the ordinal assumption for containers. The controller's
idle-checker busy probe (idlechecker.go:141) uses the same pod-DNS shape and
switches the same way. Everything else — ACP relay, terminal, SSH, file
import, skills tRPC, runtime channel, pod-service supervision — terminates at
agent-runtime *inside the guest* and works unchanged (systemd is arguably a
better init for it than catatonit).

### The VM image contract (the biggest new artifact)

A harness OCI image cannot boot a VM. VM templates need a **bootable disk
image** that ships kernel + systemd + the exact platform contract:
agent-runtime, `/usr/local/bin/harness-chat`, `/usr/local/bin/harness-terminal`,
sshd, and the guest-side plumbing above (virtiofs mount units, boot gate,
proxy/CA wiring, qemu-guest-agent).

Recommended pipeline: **bootc**. Build `FROM` a bootc base image, layer the
same harness content the pod image layers onto platform-base, and emit a
qcow2 via `bootc-image-builder`, wrapped as a containerDisk OCI image. The
harness layer is shared between both artifacts; only the base differs. CDI is
*not* required — containerDisk boots avoid DataVolume imports entirely.

Baked into the image, non-negotiable for parity: system-wide proxy env
pointing at the gateway, the platform MITM CA in the OS trust store, **and
containerd/k3s registry-proxy configuration** — nested workloads do not
inherit `HTTPS_PROXY`, and without this their image pulls are silently
dropped by the NetworkPolicy rather than routed through the gateway.

### Egress model: gated, deliberately

dam-vm containers had unrestricted VPS egress and zero credentials. A VM
sandbox inverts that: all guest traffic exits through the paired gateway,
subject to egress rules and HITL like any agent traffic — which is exactly
what makes credential injection *work* in the VM (an open-egress VM would
bypass the injecting chains and credentials would simply fail). The practical
consequence: running k3s means allow-listing registry hosts
(`registry.k8s.io`, `docker.io`, …) via egress rules, and those pulls appear
in the HITL inbox like everything else. This is a security upgrade over
dam-vm, presented as a feature, not an accident.

## Parity gaps and compromises (findings)

1. **`dam-run` and forks materialize the agent image as pods.** Run executor
   pods and Slack foreign-replier fork Jobs run `spec.image` as a container —
   impossible when `spec.image` is a containerDisk. Recommended: VM templates
   carry **both** artifacts (the containerDisk and the paired harness OCI
   image, built from the same layer), and executors/forks use the OCI image
   against the shared RWX workspace as today. Fallback compromise: disable
   `dam-run`/forks on VM agents in v1 — `dam-run`'s raison d'être (a place to
   run heavy commands) is largely subsumed by having a whole machine.
2. **k3s state does not survive hibernation.** The rootfs is ephemeral by
   design, and virtiofs is the wrong substrate for etcd/sqlite. Either accept
   cluster-rebuild-on-wake (fine for CI-style use), or add a new mount kind —
   a `disk` mount backed by a **block-mode RWO PVC** attached as a VM data
   disk (`/var/lib/rancher` target). Cost: that volume is RWO and
   VM-attached, so forks/runs cannot co-mount it; it follows the existing
   PVC lifecycle otherwise. Recommended as an optional follow-up, not v1.
3. **Wake latency.** VM boot (10–30 s) plus optional k3s start, on top of a
   multi-GB containerDisk pull on first schedule to a node. The hibernate/
   wake cycle stays correct but gets slower; VM templates should seed a
   longer hibernation timeout (the existing template-seeded override), and
   node-level image pre-pull is the operator lever. The warm PVC pool does
   not help boot time.
4. **Live resize.** The budget gate live-resizes container limits; KubeVirt
   CPU/memory hotplug is narrower. VM agents get restart-required resize in
   v1.
5. **Controller refactor surface.** Readiness, busy probe, budgets, scaling,
   and roll are StatefulSet-shaped in ~six enumerated places
   (agent_reconciler.go, idlechecker.go, budget.go, hibernation callers) —
   the work is a per-kind accessor seam, not a rewrite; `BuildAgent*` stays
   a pure-function pair.
6. **Dev/e2e clusters.** The lima k3s dev VM has no guaranteed `/dev/kvm`;
   KubeVirt's `useEmulation` (TCG) runs VMs without it — slow, but enough
   for an e2e smoke tier (`sandbox-vm-full` project under `src/tests/full/`).
   Real performance testing needs a bare-metal or nested-virt node.
7. **Ops/debugging.** No `kubectl exec` into the guest; `virtctl console`/
   `ssh` (via the existing `/api/ssh` relay) replace it. Pod-level
   termination reasons (OOMKilled, ImagePullBackOff) have VM-shaped
   analogues that must be mapped into the wake-failure classification or
   operators lose today's diagnosability.
8. **Capacity honesty.** Full memory reservation per VM agent means an
   install's practical VM-agent count is much lower than its Kata-agent
   count; budgets already model reserved compute, so the ceiling is honest —
   just low. Possibly worth a separate per-user VM budget dimension later.

## dam-vm retirement

Once VM sandboxes cover the "I need a machine" use cases:

- Delete `packages/dam-vm/` (VPS relay + provisioning), the api-server
  `harness-vm-relay`, the `DAM_VM_ENABLED` env + entrypoint/AGENTS.md block
  in platform-base, and the mTLS client-cert coupling to the external host.
- The operational win is structural: no operator-managed VPS outside the
  trust boundary, no shared-host single trust domain, no private-CA
  distribution — the VM inherits the cluster's isolation, budgets,
  hibernation, and credential plane instead of sitting outside all of them.
- Interim coexistence is fine: the features don't interact.

## Open questions

- Target KubeVirt version / OpenShift Virtualization parity for virtiofs
  (`domain.devices.filesystems`) and probe support.
- Whether the dual-artifact template (containerDisk + OCI image) is a v1
  requirement (forks/runs on VM agents) or a follow-up.
- Whether `sandbox: vm` should also gate a distinct default resource shape
  (VMs want ≥4 Gi to be useful for k3s).
