# The sandbox mounts its tools

A generic sandbox image plus a volume of mise-managed tools, so a tool version
bump is a config change rather than an image build, and one image serves every
harness.

Status: proposal, with the viability measurement already taken (see
"What the measurements say"). Nothing is built.

## What is already true

The ground is better prepared than it looks, and it shapes the whole plan.

- **Tools are already declared, not scripted.** `packages/platform-base/config.toml`
  is a mise manifest — node, python, uv, gh, jq, fd, rg, kubectl, oc, gws — with
  `lockfile = true` and a generated `/etc/mise/mise.lock` pinning them. The
  declarative config this feature wants exists; it is baked into an image rather
  than mounted.
- **Harnesses already extend it the same way.** Every agent image drops a
  `harness-tools.toml` into `/etc/mise/conf.d/`. Harness tools are a mise config
  fragment today.
- **The harness itself is already a mise install.** In a live guest the biggest
  entry is `installs/npm-agentclientprotocol-claude-agent-acp` at 263 MB. Moving
  harnesses to the volume needs no special case — it is the same mechanism.
- **A single PATH directory of tool symlinks already exists.** A `postinstall`
  hook links every tool's binaries into `/usr/local/share/tool-bin`, first on
  `PATH`. `/opt/dam/bin` is that idea at another path.
- **Runtime installation already exists.** `/usr/local/share/lazy-tools` holds
  shims that `mise install` on first use (kubectl, oc, python, gws).
- **Read-only host mounts into a microVM already work.** The runner passes
  `-v <caDir>:/etc/platform/ca:ro` to every machine and mounts a shared CephFS
  PVC for its image cache. Both halves of the delivery mechanism have precedent.

The per-harness images are thin — 23 to 69 lines — differing in four things: a
mise config fragment, the harness package, a handful of small files
(`harness-chat.sh`, `model-gateway.mjs`, a `workspace/` seed,
`runtime-manifest.yaml`), and a few environment variables.

**Size of the prize**, measured in a live guest: the mise tree is **716 MB of a
4.0 GB rootfs** — node 208 MB, the harness 263 MB, python 98 MB, pnpm 49 MB,
uv 48 MB, gh 42 MB.

## What the measurements say

Taken on dev by mounting the runner's own unpacked image tree into a throwaway
machine at `/opt/dam` — exactly the mechanism this feature proposes — so the same
`node` binary was reachable by two paths at once.

| operation (node install, 4,814 files, 208 MB) | guest, local ext4 | guest, virtiofs | runner, CephFS direct |
|---|---|---|---|
| `node -e 0`, cold | 37 ms | **238 ms** | 31 ms |
| `node -e 0`, warm | ~26 ms | ~53 ms | — |
| `find` (metadata) | 43 ms | **189 ms** | **24 ms** |
| read all 208 MB | 1.23 s | **3.49 s** | **0.23 s** |

**These are micro-benchmarks, and extrapolating them was wrong.** On the
workload that actually matters — loading the thirteen dependencies a harness
start loads — the difference is small:

| harness dependency load (warm, alternating order) | virtiofs | image (local ext4) |
|---|---|---|
| round 1 | 194 ms | 171 ms |
| round 2 | 180 ms | 156 ms |
| round 3 | 177 ms | 161 ms |

**+21 ms, +13%.** Against a ~3 s create that is not material. An earlier draft of
this plan claimed virtiofs would make the harness start "materially worse" on the
strength of the table above; the direct measurement does not support it, and the
first figures that appeared to (194 ms vs 357 ms) were an ordering artefact — the
local path ran first and paid the cold cost.

**Where the real cost lives is per-file overhead, not bandwidth.** Reading the
same 208 MB over virtiofs:

| | time |
|---|---|
| as 4,814 separate file reads | 3.49 s |
| as one `tar` stream | **0.307 s** |

virtiofs streams at 1,041–1,472 MB/s (a 121 MB binary in 0.08 s). So anything
sequential is nearly free and anything metadata-heavy is not.

**CephFS is not the problem — it is faster than the guest's own disk.** Reading
the whole tree on the runner took 0.23 s against 1.23 s inside the guest. For the
**container backend** this volume should cost nothing.

### On preloading, and why not to

The obvious fix for per-file overhead is to stage the tree locally before use.
Measured in the guest:

| | cost |
|---|---|
| copy the 673 MB tree to the guest's ext4 disk | **10.7 s** |
| copy node alone (208 MB) to tmpfs | **1.38 s** |
| exec from the staged ext4 copy | 39 ms — as fast as the image |
| exec from tmpfs | **fails**: `/dev/shm` is `noexec` |

Every one of those costs more than the +21 ms it removes, so staging is not worth
doing for its own sake. Two notes for whoever revisits this:

- **smolvm already implements it.** `-v <host>:<guest>:staged` "runs from a
  guest-local copy for metadata-heavy workloads". If a future tool set proves
  metadata-heavy, the flag is there — no invention needed.
- **A single-file image would sidestep the overhead on both sides**, since the
  cost is per file, not per byte. The guest kernel has **erofs** built in
  (squashfs does not), but there is no `/dev/loop-control` and smolvm exposes no
  extra-disk flag, so mounting one would need upstream work. Worth remembering,
  not worth building now.

## The shape

One RWX volume, written by a job, consumed differently by the two backends.

```
/opt/dam/
  versions/
    2026-09-18-a1b2c3/        # content-addressed by config + lock hash
      amd64/{bin,installs,...}
      arm64/{bin,installs,...}
  current -> versions/2026-09-18-a1b2c3
```

- **The builder** is a Job that mounts the volume read-write, runs `mise install`
  into a fresh `versions/<hash>` with `MISE_DATA_DIR` pointed there, verifies,
  then flips `current`. A published version is never mutated, so rollback is a
  symlink rather than a rebuild.
- **Container agents** mount `current/<arch>` read-only at `/opt/dam`, with
  `/opt/dam/bin` early on `PATH`. On the measurements above this is the easy win.
- **VM agents** get one more `-v <path>:/opt/dam:ro` on the machine — the flag the
  runner already uses for the CA bundle. The measured cost is +21 ms on a harness
  dependency load, which is the price of admission and not worth engineering
  around. `:staged` is there if a future tool set turns out to be metadata-heavy.

## Decisions I need from you

**D1 — how far does this go?**

| | what moves | what is left in the image |
|---|---|---|
| A | the long-tail tools | OS, agent-runtime, node, harness |
| B | A + node + the harness packages | OS, agent-runtime, harness files and env |
| C | B + the harness files | one image; harness identity entirely in config |

The measurements put **A and B both within reach on both backends** — the
virtiofs penalty is +21 ms, not the multiple I first assumed. A is still the
right first step because it is reversible and touches nothing on the startup
path; B is where "one image for every harness" actually arrives, and the harness
being a mise install already makes it mechanical. C buys little and puts
agent-visible files behind a volume flip.

**D2 — replace the image's tools, or shadow them?** Shadowing (`/opt/dam/bin`
ahead of `tool-bin`, image keeps what it has) makes every step reversible and
keeps agents working where there is no RWX storage — the local k3s cluster, for
one. Replacing is what actually shrinks the image. Shadow first, measure, then
delete from the image as a separate change.

**D3 — one tool set or several?** A union volume is simplest and dedupes across
agents; per-harness subtrees cost disk but let one harness pin a different node.
Union first, unless two harnesses already want conflicting pins.

## Risks

- **R1 — virtiofs cost on the VM backend.** Measured, above. It is the reason
  D1/A is the starting point rather than B.
- **R2 — virtiofs has bitten us here before.** `DAM on rits OpenShift` records
  virtiofsd EPERM and a root-in-guest workaround. A second, much larger mount is
  not the same test as the CA bundle — though the throwaway machine in this plan
  mounted 673 MB over virtiofs without complaint, which is encouraging.
- **R3 — blast radius.** An image rollout reaches agents one restart at a time; a
  symlink flip reaches all at once. Publish behind a hash, keep N previous
  versions, and consider staging the flip per owner.
- **R4 — agents install their own tools.** The lazy-tools shims run `mise install`
  at runtime and agents `npm i -g` freely. The per-agent writable `MISE_DATA_DIR`
  must stay; the volume is an additional `PATH` source, never the only one. This
  is why D2 leans to shadowing.
- **R5 — storage.** Needs RWX. CephFS on dev/rits; the local k3s cluster needs
  the D2 fallback. Check what `nfsProvisioner` in `helm/values.yaml` is for
  before assuming.
- **R6 — integrity.** The volume becomes a new way to change what runs inside
  every sandbox. `mise.lock` pins with checksums and the builder verifies, but
  the config driving it deserves the same review gate as a Dockerfile, not a
  ConfigMap anyone can edit.

## Phasing

1. **Confirm the container-backend read cost in a pod.** The runner numbers say
   it is free; prove it where it will actually run.
2. **Build the publisher**: config → hash → `mise install` into `versions/<hash>`
   → verify → flip. No consumer yet; prove idempotence and rollback.
3. **Consume in the container backend**, shadowing, one template first.
4. **Consume in the VM backend** for the long tail only (D1/A), one more `-v`.
5. **Move node and the harness** (D1/B), collapsing the per-harness build matrix.
   Re-measure a real harness start from the volume before and after — the +21 ms
   here is a dependency-load proxy, not a full start, because the harness needs
   env a bare test machine does not have.
6. **Shrink the image** by deleting what the volume now provides. This is where
   the startup win is realised, and it is the least reversible step, so it is
   last.

Steps 1 and 2 are independent of each other and of the backends.
