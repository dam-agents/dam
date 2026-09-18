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

Two conclusions, and they point in opposite directions for the two backends.

**CephFS is not the problem — it is faster than the guest's own disk.** Reading
the whole tree on the runner took 0.23 s against 1.23 s inside the guest. So for
the **container backend**, mounting this volume should cost nothing and may be
quicker than the image layer. That wants confirming in a pod, but the signal is
strong.

**virtiofs is the tax.** Into a guest it is 2–3× slower on bulk reads and ~4× on
metadata, and 6× on a cold exec. The guest's `/` is an overlay whose lower layer
is local ext4 (`/dev/vda`), so this was a fair comparison, not an artefact.

That matters because it lands on the work that just took agent creation from
20.8 s to ~3 s. The harness start is ~1.5 s of mostly module loading; served over
virtiofs it would be materially worse. **Putting node and the harness behind
virtiofs would undo that.**

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
- **VM agents** must not read hot tools over virtiofs. Two candidates:
  - **(i) materialise at create** — the runner copies the tree onto the machine's
    ext4 storage disk when the machine is made, so the guest reads locally. The
    source read is cheap (0.23 s on CephFS); the write is the unknown.
  - **(ii) split by temperature** — hot path (node, harness) stays in the image,
    the long tail (kubectl, oc, gh, gws, python, uv) comes over virtiofs. Those
    are lazily installed at runtime *today*, so virtiofs is strictly better than
    what they do now.

(ii) is cheap and safe and can ship first. (i) is what makes "one image for every
harness" reachable on the VM backend, and it needs its own measurement before
anyone commits to it.

## Decisions I need from you

**D1 — how far does this go?**

| | what moves | what is left in the image |
|---|---|---|
| A | the long-tail tools | OS, agent-runtime, node, harness |
| B | A + node + the harness packages | OS, agent-runtime, harness files and env |
| C | B + the harness files | one image; harness identity entirely in config |

The measurements say **A is safe on both backends today**, and B is safe on the
container backend but needs (i) above for VM agents. I would ship A, measure (i),
then decide about B. C buys little and puts agent-visible files behind a volume
flip.

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
5. **Measure (i)** — materialising the tree onto the machine's disk at create.
   This decides whether B is reachable for VM agents.
6. **Shrink the image** by deleting what the volume now provides. This is where
   the startup win is realised, and it is the least reversible step, so it is
   last.

Steps 1 and 2 are independent of each other and of the backends.
