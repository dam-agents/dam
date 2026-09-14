# MicroVM runtimes for the sandbox node — survey and prototypes

Status: research note, 2026-09-14. Compares the runtimes that could replace
smolvm inside the sandbox node pod ([platform-topology](../architecture/platform-topology.md#sandbox-node)).
The bar, set by JP: a guest must run k3s, the host must get memory back when
the guest frees it (virtio-balloon with free page reporting), and the option
must not be obviously worse than the smolvm implementation that works today.
Anything that fails the bar is recorded with its evidence and skipped.

## What smolvm gives us today (baseline)

- k3s inside the guest: works, documented upstream; its libkrunfw fork adds
  VXLAN, xtables and iptables/masquerade to the guest kernel.
- Balloon: inflate/deflate plus free page reporting; measured on 2026-09-14 —
  a 4 GiB machine idles at ~460 MiB host RSS and returns 1.5 GiB of freed
  guest memory within ~50 s.
- Boots the OCI image directly; persistent virtio-blk storage disk; in-process
  NAT networking; only `/dev/kvm` needed. Live CoW fork and checkpoints.
- Risks: one maintainer, a hard fork of libkrun, a hard 30 s agent-ready wait,
  arm64 snapshot paths less exercised.

## Verdicts

| Runtime | k3s in guest | Balloon + free page reporting | Verdict |
|---|---|---|---|
| libkrun direct | only with a self-built kernel (stock libkrunfw lacks VXLAN and xtables) | free page reporting only, no inflate | skip: rebuilds smolvm's kernel, balloon and OCI-to-disk work |
| go-microvm (stacklok) | no: stock kernel, virtiofs root breaks overlay2 | inherited, no inflate | skip: experimental, no block root |
| Firecracker | with a custom kernel (CI config lacks xt_comment/multiport, ipset, nft_masq) | yes (reporting is developer preview since 1.14) | prototype (second) |
| firecracker-containerd | no (container-in-VM model) | unknown | skip: x86 only, privileged containerd, no releases |
| Flintlock | yes by design (k8s nodes) | unknown | skip: host daemon + devmapper, no snapshot or balloon |
| Mitos | unlikely (EOL 5.10 kernel, agent as PID 1) | unknown | skip: x86 only, four months old |
| Cloud Hypervisor | yes (any kernel or cloud image) | yes, plus virtio-mem | prototype (first) |
| Cocoon / Cocoon Sandbox | unknown (kernel must be baked into the image) | yes | skip as a dependency: root, forked CH, AGPL server; useful reference |
| Kata + Dragonball | measured no on the dev cluster: guest kernel has neither iptables nor nftables, `/dev/kmsg` absent | yes | skip: a CRI runtime, not an embeddable VMM; arm64 Dragonball broken as of 2026-08 |
| Alioth | unknown (bring your own kernel) | work in progress | skip: no control API, experimental, one maintainer |
| StratoVirt | with own kernel | yes, but exclusive with snapshots | skip: tap only, QMP, upstream moving |
| Hyperlight | no Linux guest | no | skip |
| Slim | build tool, abandoned 2022 | no | skip |
| microvm.nix | NixOS guests only | qemu and CH only | skip: build tool, Nix-only |

Sources are in the survey transcript; the key ones: smolvm's libkrunfw fork
configs and k3s guide, libkrunfw's stock configs, Firecracker's
`kernel-policy.md` and CI kernel configs, Cloud Hypervisor's `balloon.md` and
`snapshot_restore.md`, Kata's `configuration-dragonball.toml.in` and issues
#8237, #13768, #13486.

## Kata measured

On the dev cluster's Kata pool (OpenShift sandboxed containers, QEMU), a
privileged `rancher/k3s` pod under `runtimeClassName: kata`:
kubelet needs `/dev/kmsg` (absent; `mknod` works), then kube-proxy fails with
"iptables is not available on this host" and, in nftables mode, "Unable to
initialize Netlink socket: Protocol not supported". The guest kernel there
has no netfilter. Dragonball would need our own node setup, and its arm64
build did not boot with stock configs two weeks before this note.

## Prototypes

Scripts in [`meta/microvm-prototypes/`](../../meta/microvm-prototypes/): a
shared guest (Ubuntu 24.04 cloud image, cloud-init installs k3s and reports on
the serial console, a NAT'd tap) and one runner per VMM that records boot and
k3s timings and the VMM's host RSS before and after the guest frees 1 GiB.
Run on the local Lima k3s VM (arm64, nested KVM, 10 vCPU) — the same nested
host the sandbox node pod uses locally, so absolute numbers are pessimistic.

Measured 2026-09-14 (2 vCPU, 2 GiB guests, Ubuntu 24.04 cloud image, k3s
installed from the internet inside the guest):

| | Cloud Hypervisor v53 (EDK2 firmware, Ubuntu 6.8 kernel) | Firecracker v1.17 (project CI kernel 6.1) | smolvm 1.16 (own libkrunfw 6.12) |
|---|---|---|---|
| guest boot to cloud-init | 73 s (full UEFI + systemd boot under nested KVM) | systemd at 43 s, cloud-init network stage done at ~12 min with "soft lockup" warnings (run shared the host with two other guests) | 10–20 s to the smolvm agent, same host |
| k3s node Ready after install | 39 s | not reached within the 15 min cap | ~15 s on bare metal (earlier measurement) |
| pod scheduled and Running | yes | not reached | yes |
| balloon driver in guest | yes | not measured (device accepted by the API) | yes |
| host RSS: idle → 45 s after guest freed 1 GiB | 1.31 GiB → 1.70 GiB (nothing returned) | not measured | 460 MiB → 460 MiB after ~50 s (returned) |

Cloud Hypervisor caveats seen: `free_page_reporting=on` with the stock Ubuntu
kernel returned no memory in the 45 s window even though the guest driver was
present — the balloon needs a follow-up before it counts as equivalent to
smolvm's reclaim; an ACPI shutdown request via `ch-remote` did not power the
EDK2 guest off (killed instead).

Firecracker caveats seen: the 6.1 CI kernel cannot mount an ext4 made by
Ubuntu 24.04 (`orphan_file` feature; stripped with `tune2fs -O ^orphan_file`),
and marking a partitioned disk `is_root_device` makes Firecracker append its
own `root=/dev/vda`, overriding the partition; there is no kernel with modules,
so anything k3s needs must be built in; the CI kernel also has no GPT
support, so the root partition had to be carved into a partition-less image.
Under this nested-KVM host the Firecracker guest ran an order of magnitude
slower than the same image under Cloud Hypervisor, which matches the
project's "nested is unsupported" stance; a bare-metal rerun is needed before
its numbers mean anything.

## What replacing smolvm would cost

Both survivors are VMMs, not OCI runtimes. Each needs, on top of what
sandbox-node does today: an OCI-to-disk step (flatten the image to ext4 with a
kernel and initrd the VMM can boot), a tap per machine with NAT (CAP_NET_ADMIN,
which the node pod already has), and our own guest agent or SSH for exec.
Cloud Hypervisor's OpenAPI socket and Firecracker's REST socket are both a
generated Go client away. Cocoon is the closest existing implementation of
that pipeline on Cloud Hypervisor and is worth reading before building one.
