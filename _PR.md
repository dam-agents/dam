# feat/multi-node — key findings (remove before merge)

## What this branch does

Nodes are provisioned as VMs (dam-vm bootc image) and joined to the platform;
the api-server schedules sandboxes across them (leader lock, node registry,
peer links, fair share, sandbox supervisor), with a single-command local
install and a review pass that removed accidental complexity (see the commit
log on this branch for the individual fixes).

## Status of verification

- Controller/api-server tests and the local install pass.
- Deployment on the OpenShift `vm-test` project was **not** completed: the
  node disk image cannot be built on this Mac (see below) and pushing to quay
  from the sandboxed shell is blocked.
- Uncommitted dam-vm image/disk-task changes remain in this checkout
  (Containerfile native-toolchain stage, disk task running skopeo/bib on the
  host arch with `--target-arch`, cloud-init left to the preset).

## Findings

- **The amd64 node disk cannot be built on an arm64 Mac.** `bootc install
  to-filesystem` in the Fedora 44 image dies with `Function not implemented
  (os error 38)` under both Rosetta and qemu-x86_64 (a mount-listing syscall
  no user-space emulator forwards); GNU tar under Rosetta and skopeo's layer
  unpack re-exec break the same way. Build the bootc image locally, produce
  the qcow2 natively on x86 (CI `build-node-disk`, or a privileged pod on the
  rits CNV worker).
- **KubeVirt as the sandbox substrate is expensive and awkward** (measured on
  the rits bare-metal worker): the virt-launcher pod requests guest memory +
  ~290 MiB regardless of use; virtio disk makes guest-native `tar` ~3× slower;
  nested KVM inside the guest is the worst platform on every test; virtiofs
  refuses non-root creates in the guest (EPERM), forcing root-in-guest.
- **Sandbox runtimes compared** (4 vCPU / 8 GiB, seconds): gVisor is 3–5×
  slower than native on exec/stat-heavy work either platform and ~30 % slower
  on `npm install` with host networking (~65 % with netstack); smolvm is
  native-speed for guest-local fs/exec, boots in ~2 s, but its virtiofs host
  mount is ~7× slower than native for small files. gVisor cannot run an inner
  k3s (no `/dev/kmsg`, cAdvisor rootfs lookup fails, `/proc/sys/net` sysctls
  missing); smolvm can (`--net-backend virtio-net`, node Ready in 11–15 s),
  also nested inside a KubeVirt guest.
- **Conclusion drawn from this branch:** run vm-backend agents as smolvm
  microVMs on a dedicated non-Kubernetes sandbox node rather than as KubeVirt
  VMs on Kubernetes nodes; per-user fair-use limits can replace hard per-
  sandbox caps later. That follow-up lives on `feat/smolvm-node`.
- Environment notes: the upstream LiteLLM key reaper deletes bad keys within
  minutes (a 401 `token_not_found_in_db` is not a platform bug); `vm-test` on
  rits needs the ambient CA override and probes off.
