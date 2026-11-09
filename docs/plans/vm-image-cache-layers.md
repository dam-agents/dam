# Layer-level VM image cache

The per-node VM image cache keeps every image as one flattened tree, fetched whole for every new digest.
This page designs a cache that keeps layers instead, in two steps.
Step 1 keeps the compressed blobs, so a node downloads only the layers it lacks.
Step 2 keeps one unpacked tree per layer and links image trees from them, so a node stores a layer once for every image that carries it.

**Status: proposed, for review before any code.**
Step 1 is designed to be built.
Step 2 is designed in outline, with the contracts it must settle before its own plan.
[`docs/architecture/vm-image-cache.md`](../architecture/vm-image-cache.md) describes the cache as it is and stays the source of truth until a step lands.

## Problem

A machine boots from a tree that the image cache service unpacks with `crane export`, one tree per image digest.
The cache keeps no blobs and no layers, so each new digest is a full download and a full unpack.

The agent images are layered by how often each part changes: the apt base, the harness tools, Selkies, mise, Claude Code's adapter, and the agent-runtime on top.
A typical deploy changes only the top layer, about 1.3 MB.
Measured on main in November 2026:

- `default` is 1.93 GB compressed and 4.2 GiB unpacked, and its top layer is 1.3 MB.
- `default`'s source changes about 12 times a day, the tools about 5 times a week, the apt base about once a week.
- Every deploy that changes `default` makes every node with a runner download 1.9 GB and unpack 4.2 GiB again.
- Each workload image (nous, gepa, k-search, …) is `default` plus one venv layer, but the cache keeps a full private tree for each.
  `default` and six workloads take about 45 GiB of trees, about 25 GiB of it `default`'s content again.
- The budget is `imageCache.budget: 20Gi`.
  An old `default` that running machines still hold, the new one and k-search do not fit in it.

The waste grows with the deploy rate, the node count and the number of workloads, and it is in the boot path: a machine on a new image waits for the whole fetch.

Neither step changes the runner, virtiofs, platform-init or the guest: a machine still boots one read-only tree.

## Step 1: a blob cache

### What it keeps

The service keeps compressed layer blobs by digest in `<dir>/.blobs/sha256_<digest>`, beside the trees, each with its own origin record: the platform and the repositories it was downloaded from.
The directory starts with a dot because the cache's reclaim of earlier layouts deletes every `<dir>/<name>/sha256_*` whose name does not, so a binary from before this step leaves the store in place rather than deleting it.

### How a fetch works

A fetch reads the manifest and the config, as today.
It downloads each blob it lacks, writes it to a scratch path, verifies the whole stream against the manifest's digest and size, and renames it into the store.
A blob that fails its digest is discarded and the fetch fails as an unusable image.
It then flattens the image from local blobs into a scratch tree with the same rules as today: `crane export` reading a docker-save stream on stdin, built from the manifest, the config and the stored blobs, and piped to the same `tar` with the same arguments.
The repository already flattens images that way when it stages one for a local install and when it checks the runner image.
The stream is generated, not written to disk, so the fetch keeps no temporary archive.
crane reads a docker-save stream's layers as all gzip or all plain, judged by the first layer, so an image whose layers mix compressions, or use zstd, is fetched as today, with `crane export` from the registry.

Everything after the unpack is unchanged: the launch record, the origin record of the tree, the rename into place, the flush rule, holds, pins and eviction of trees.
The extraction keeps today's baseline: no xattrs, no SELinux labels from the image, no file capabilities, directories not overwritten (`--no-overwrite-dir`), and `/dev` skipped.

### Access

A blob is a piece of someone's image.
A caller can serve, from a registry of its own, a manifest that names the digest of a private blob another owner fetched, without holding that blob's bytes.
So a stored blob is reused only under the same rule an image tree has today, applied per blob:

- A blob read anonymously from one of its origins is public and reusable by anyone.
- A blob that one of the caller's credentials reads from one of its origins is reusable by that caller, and the grant is remembered per digest and credential for `ref_fresh`, as image grants are.
- Any other blob is unproven: the service downloads it again from the caller's repository and verifies it.
  A registry cannot forge bytes that match a digest, so a verified download is the proof, and the caller's repository joins the blob's origins.

The proof of a read is a `GET` of the blob from the origin with the caller's credential, stopped after its first bytes, not a `HEAD`.
Registries differ in what a `HEAD` on a blob checks: some answer from a global store, some redirect, some answer for a blob a cross-repository mount put there without the caller ever reading it.
A request that answers with the first bytes of the blob, from that repository, with that credential, is the proof the registry gives the content to the caller.
A mount request or a copied manifest earns a repository no place in a blob's origins: only a verified download does.

**An image tree is reused only when every blob of the image is.**
Today a cache hit on an image tree checks the image's manifest in its origins and serves the whole tree.
Once blobs are shared, that check is not enough: an image whose manifest is public can be assembled from a private blob by someone who holds the private one, and the next anonymous caller would boot that blob's contents.
So a hit on an image tree also checks each of the image's blobs by the rule above, and an image counts as public only when its manifest and every one of its blobs are public.
Grants are cached per digest and credential, so a fleet of creates on one image still asks the registry once per blob.

### Size and eviction

The store counts toward the budget.
A blob is in use while an image tree in the cache is the unpack of an image that names it, so the next digest of that image finds its unchanged layers.
Eviction takes the oldest unheld image tree first, as today, and then the blobs no remaining tree names, oldest write first.

The store holds the compressed layers of every cached image beside their unpacked trees, about half as much again as the trees alone for the agent images.
That is the price of step 1, and it is why the budget's default should rise with it.

Admission reserves what a fetch adds:

- the compressed size of each blob it must download, from the manifest;
- the unpacked size of the image, estimated as today from the gzip trailers;
- the records.

A blob that two concurrent fetches both need is reserved and downloaded once: the fetch gate that today serializes fetches of one image also covers each blob.
The download is bounded by the manifest's size for each blob, as the unpack is bounded by its estimate.

### Restart and downgrade

A blob is whole under its name or not there: it is written to a scratch path and renamed into place after it verifies.
A blob written in an earlier boot and never flushed is downloaded again, as a tree is.
At open the service rebuilds which blobs each tree uses from the tree's manifest, which the tree's records keep, before any eviction runs.

A binary from before step 1 serves the trees as today and does not touch `.blobs/`, which it neither counts nor evicts.
After a downgrade that runs long, an administrator can delete `.blobs/` by hand, and the runbook says so.
A binary of step 1 that finds a tree from before it, with no manifest in its records, serves it, weighs it as today, and fetches its blobs only when it next fetches that image.

### What step 1 saves

A deploy that changes one layer downloads that layer: about 1.3 MB per node for a change to `default`'s top layer, instead of 1.9 GB.
The first boot of a workload on a node that already has `default` downloads only the workload's own layer.
The unpack and the duplicated trees stay as they are.

## Step 2: a tree per layer (outline)

Each layer is unpacked once into `<dir>/.layers/sha256_<diff id>`, and an image's tree is built by applying its layers in OCI order as hard links to those trees.
A deploy that changes the top layer then unpacks only that layer and links a new tree, and `default` and its workloads share one copy of `default`'s layers: about 17 GiB instead of about 45 GiB on a node with all seven, estimated from the compressed sizes at about 2.5 times compression.

These contracts must be settled in step 2's own plan before it is built:

- **The blob to diff id binding.** A layer tree is found by diff id, which an image's config states and anyone can state.
  A layer tree is reused for an image only through a binding of a verified blob digest to that diff id, made when the service decompressed that very blob, hashed the whole uncompressed stream including what follows tar's end marker, and found the diff id.
  A new compression of a diff id already stored is still downloaded and verified against it.
  The service also checks that the config lists as many diff ids as the manifest lists layers.
- **A layer is a changeset, not a tree.** A whiteout removes only what earlier layers put at its path, whatever its place in the tar; an opaque marker does not remove what its own layer adds; a directory the extraction creates implicitly does not override an earlier layer's metadata; a directory can replace a file and a file a directory; a hard link inside a layer can name an entry later in the tar.
  So each layer keeps a record of its operations beside its tree, and the composition reads that record.
  The composition must also refuse to follow a symlink an earlier layer put in a path's ancestors.
- **Immutability.** Every link to a layer tree shares its inodes.
  Nothing may write, `chmod`, `chown` or relabel a file of a layer tree after its unpack.
  A file whose metadata a later layer changes is a new file of that layer.
  The SELinux label is set once, at the unpack, and is the same for every tree.
  Linking and unlinking still change a shared inode's link count and ctime, which a guest's virtiofs may cache.
- **Metadata.** Step 2 keeps step 1's baseline (no xattrs, no image labels, no file capabilities), and records mtimes as the layer carries them.
  Extending it is a separate decision.
- **Accounting by `(device, inode)`.** The cache's use is every distinct inode once, plus the directories of the image trees, where the links' cost is.
  What an eviction frees is a tree's directories, plus the layer trees and blobs no remaining tree uses.
  Admission credits only that, and counts a deletion still running in the background only once it is done.
  The link farm of an image with no missing layer is reserved too.
- **Dependencies across restarts.** Each image tree records its layers and their bindings, and the service rebuilds the references from those records at open, before any eviction.
  An image tree whose layers were not all flushed is fetched again.
- **Naming beside the old tree.** A tree linked from layers lives in a namespace of its own, so an old flattened tree of the same digest stays in place until it is evicted, and the runner is told which of the two to boot.

Each needs a test on a real node with two images that share layers.
Boot both, then read and stat the shared files from both guests while one copies a shared file up.
Then stop one machine, evict its image, check that the eviction happened, and check that the other guest and its tree did not change.

## Out of scope

- How CI builds and publishes images.
  It already produces content-addressed layers, and keying them by their inputs is separate work.
- Booting several read-only trees stacked in the guest instead of one linked tree.
  It avoids the link farm, but it changes the runner/guest protocol, which rolls out behind busy agents for up to a day.
  It stays in reserve, in case linking time shows up in boot latency.
- Shipping the base in the runner image.
  It would tie every tools bump to a runner rollout, and give a custom image nothing.

## Sub-issues for step 1

1. **The blob store and the flatten from local blobs.**
   Download, verify and store blobs; build the docker-save stream from the store into `crane export -`; fall back to today's export for mixed or zstd layers.
   Tests: an image that shares layers with a cached one downloads only the new blob; a blob with a wrong digest fails the fetch and leaves nothing in the store; a whiteout across layers flattens as it does today.
2. **Per-blob origins and the access rule**, including the check of every blob on an image-tree hit.
   Tests: a caller whose registry names another owner's private blob downloads it again from its own registry; an image with a public manifest and a private blob is not public.
3. **Admission, eviction and the store's restart rules**, with the store counted in the budget.
4. **Docs:** `docs/architecture/vm-image-cache.md`, and `agent-images.md`, which still says a node stores shared layers once, which holds for containerd and not yet for the VM cache.
