# VM image cache

Last verified: 2026-10-19

A machine may reach only its gateway, so its image is fetched for it and unpacked into a tree every machine of that image mounts read-only.
That tree is never on the runner's claim: it lives in a **node cache**, a host directory every runner scheduled on the node shares, so the same few harness images are fetched once per node rather than once per owner.
The install names a root once the `vm` Backend is on — `imageCache.hostPath` — and the chart keeps this install's cache in its own subdirectory of it, `<release namespace>-<release name>`: nodes are shared, and an install given another install's cache directory is a second writer of it, so the directory is named after the pair the cluster already keeps unique rather than left to whoever sets the value.
It refuses a root that is not a path on the node, and one whose subdirectory lands inside the release directory, which the stager prunes.
It is a host directory, not a `ReadWriteMany` claim, the costliest class, which buys only cross-node dedup.
On OpenShift the runners need an SCC that admits a host directory, which the chart's own does not — and one that leaves the SELinux type to the pod: SELinux confines every container to a type that may neither write nor read a directory the kubelet creates on the host, so the image cache service runs there as the unconfined container type at the plain level and labels the directory for containers as it opens the cache.
Every tree it unpacks inherits that label, which is what lets the runners, still confined, boot from it; the label is set from the chart's OpenShift signal, and a service that cannot set it says so and exits rather than serve trees no runner could read.
The node configuration in [`etc/openshift-node-config/`](../../etc/openshift-node-config/) has the nodes create and label the parent directory: the kubelet creates this install's own subdirectory under it for the cache pod's volume, and the service labels that subdirectory for containers as it opens it.

**The cache has exactly one writer**, a per-node **image cache service**: runners mount the directory read-only and ask the service, over a socket inside it, for each image a machine boots.
The service resolves the reference, fetches and unpacks it on a miss with the pull secrets the runner forwards for that machine ([security-and-credentials](security-and-credentials.md#image-pull-credentials)), and answers with the tree and what the image says to run.
A runner that could write a shared directory would let a guest that escapes into it rewrite a tree another owner's machines boot; one writer also means a fetch and an eviction never have to agree across processes, so what the writer knows about the cache is kept in its memory — all but where each tree came from, which is written beside the tree because a later caller's access is checked against it.
The service is therefore in the boot path: with it down, a runner boots only an image one of its own machines already holds, and refuses any other as unavailable rather than booting it straight from the registry.
The runner fetches nothing itself, so it holds none of the capabilities an unpack takes, and it resolves no name: its egress policy admits no resolver ([vm-runner](vm-runner.md)).
The service resolves the registries itself, through the cluster DNS pods unless `imageCache.dnsPolicy` says the node's resolver.
It is the one pod of the install that fetches, so its own egress policy is the gate on what a compromise of it reaches: the public internet minus every range the cluster owns — private, loopback, link-local, CGNAT and this-network, which hold the platform's own datastores, the node and the cloud metadata endpoints — the cluster DNS pods on their ports, the pods and ports an in-cluster registry names in `imageCache.peers`, and the range an install names in `imageCache.egressCidrs` for a mirror outside the cluster on a private address.
An in-cluster registry is reached by pod rather than by range: policy is applied after a Service's address is translated to a pod, and that pod's address is in a range the policy closes.
Nothing dials it: the runners reach it over the Unix socket in the directory they share with it, which no policy sees.
The service unpacks with every capability dropped but the few that restoring an image's owners and modes takes, and skips the image's `/dev`, so no tree carries a device node.
No entry lands outside the tree: tar strips a leading `/` and refuses a member that names `..` or a path through a symlink, and the fetch fails on either.
A tree keeps the setuid binaries its image carries, because a guest boots it as root on its own kernel and its `sudo` or `su` has to work there.
The host never runs them: a hostPath takes no `nosuid` mount option, so the node directory is closed to every host uid but root, and a runner reads it as root through its idmapped mount, under no-new-privileges.

**Moving that directory is a two-deploy change.**
An upgrade that moves it reaches the runners that roll, and the rollout holds a runner back while its owner has a busy agent — up to `runner.rollout.idleWait`, a day by default — so for that long a runner still mounts the directory the release before gave it and dials the socket inside it.
That socket is gone once the service serves the new directory, and a runner that dials it boots only the trees its own machines already hold.
So the first deploy sets `imageCache.legacyPath` to the directory the previous release served, which runs a second cache service over it: the runner the roll has not reached keeps booting from it, and a tree it needs and does not hold is still fetched.
That service pins nothing, so the window costs a second service over the old trees rather than a second copy of every harness image.
The second deploy, once every runner has rolled, removes the key.
The legacy directory may hold neither the install's new directory nor sit inside one: a service over a directory that holds the other's trees evicts them as its own least recently written.

**An entry is named by the image it holds, not by the reference that asked for it.** A create resolves its reference to a digest and boots the tree stored under it, so two tags of one image share a tree and a mutable tag is never frozen at what it first named.
The writer remembers what a tag resolved to for a few minutes; a pinned digest is never resolved, and a registry that cannot answer boots what the tag last resolved to.
A machine records the digest it booted, which is how its runner knows, even after a restart, which tree it holds once the tag moves on.
Every registry read names the host's platform, so a tag resolves to that platform's own image rather than to a multi-arch index, and each tree records the platform it was unpacked for: a claim that moves to a node of another architecture fetches a pinned index digest again rather than booting a tree it cannot run.

**A tree is either whole under its name or not there.** A fetch unpacks into a scratch tree and only then renames it into place; an eviction renames the tree away before it deletes it, and deletes it in the background, so no resolve waits on it.
A fetch does not flush its tree, since a flush of the whole filesystem stalls every machine disk on it: the tree records the host boot it was written in, the writer flushes once as it closes, and a tree an earlier boot wrote and never flushed is fetched again rather than booted.
After a host crash, every image fetched since the writer last closed is therefore fetched again.
A writer that dies mid-fetch or mid-eviction leaves only a scratch tree, which the next open reclaims, never a partial tree a lookup would take as complete.
A fetch that finds an incomplete tree, or another platform's, under its name moves it aside and puts its own in place.
A resolve has one deadline for everything it does, fetch included, and a runner waits a little past it, so a service that is slow is told apart from one that is gone — only one that is gone lets a runner boot a tree it already holds.
A fetch that fails for its image — a registry refusing the export, a stream tar cannot unpack, or one larger than the cache reserved for it — is reported as an unavailable image, and a disk that fills, or has less room than the image takes unpacked before the download starts, as a lack of capacity, never as a boot to retry at once into the same state.

**Eviction never frees a tree a machine is running from.** It takes the oldest write first, down to a byte count the install states, sparing what is held.
A fetch evicts before it downloads, until both the budget and the filesystem have room for the tree it unpacks.
OCI metadata names only compressed sizes, so the writer reads the size each gzip layer unpacks to from the last four bytes of its blob, its gzip trailer, with one ranged read per layer and the token crane gets for the caller's credential.
On common images the summed trailers came within 3% of what crane exports, so a measured layer is taken at its trailer and a tenth more, plus 64 KiB for tar's end blocks and padding.
An uncompressed layer is its blob's size.
Any other layer is taken at four times its compressed size, above the 2.2 to 3.2 that common images unpack to: a zstd layer, one whose registry refuses the ranged read or does not answer it within 20 seconds, and one whose trailer reads well below its blob, such as an eStargz footer.
A failed read only falls back to that estimate and never fails the fetch.
That size is also the most the fetch may unpack, with a floor of 16 MiB for a tiny image and the whole budget for one whose manifest cannot be read: the writer counts the stream between crane and tar and stops the fetch past it, so an image whose layers inflate is refused rather than fill the disk every machine on the node shares.
A trailer counts only the last gzip member of its blob and holds its size mod 4 GiB, so a layer of several members or past 4 GiB can read short; a fetch stopped at a measured size is tried once more, reserved and capped at the larger of each layer's measured size and four times its blob.
A runner holds the digests its running machines boot by naming them again every minute, and a hold lapses only once nobody names it — a runner that stopped has no machines left.
A runner names every machine its runtime finds running from the moment it starts, so one that took the machines over in a hand-off or a restart holds their trees before the controller has sent it a spec.
A stopped machine holds nothing, so a hibernated agent never keeps an image a deploy retired; its start fetches the tree again when it is gone, and holds it before it checks it is there.
A hold only extends, so no runner can release what another holds, and only a tree on disk is held, so a resolve that fails holds nothing; past half again its budget, the service fetches nothing.
Each fetch under way counts toward that ceiling at that unpacked size, so fetches that start together cannot each find the cache under it.
A service that restarts has forgotten every hold, so it evicts nothing until the runners have had time to name theirs again.

**Nothing could fill that cache before an agent needed it.** A runner exists only once its owner's agents need one, so the first machine on an image, on every node after every deploy, would wait out the fetch with a user watching.
The service therefore preloads the harness images the install ships, resolving their tags on every pass, and pins them against eviction.
A fetch keeps nothing when it fails, so a digest whose preload failed is fetched again only after a wait that doubles with each failure, from one interval up to six hours; a tag that moves to another digest is fetched on the next pass.
That set is fixed at deploy, so a custom agent image is never among them.
It preloads with the install's default pull secrets, mounted into it, so an image only a per-template secret reads is fetched when a machine first needs it.

**A private entry is checked per machine.** A shared cache would hand one owner's fetch to every owner naming the image, so an entry an anonymous read could not reach is served only to a machine whose own pull secrets read its manifest in a repository the entry was fetched from.
The repository a caller names is never what is asked, because anyone can name any digest under a registry of their own that answers every read; a caller naming the digest in a repository it was never fetched from proves its access by fetching it from there, and that repository then joins the entry's origins.
A read with no credential is anonymous even where the service's own environment holds one.
An anonymous read of an origin that succeeds marks the entry public, and only an entry not known to be public needs the registry to boot.
The service keeps that knowledge in memory, so after a restart it asks again.
A grant is remembered per digest and credential, and a failed anonymous read per digest, for as long as a tag's resolution is trusted, so a fleet of creates on one private image asks the registry once; a revoked pull secret still boots a tree it was granted for that long.
A remembered failed read only moves the anonymous read after the caller's credentials, and never refuses a boot by itself, since a read that timed out looks the same as one refused.
The check gates a boot, not a read.

**What a runner may read on a node cache is not gated.** Its mount is the whole directory, so any runner on the node — and any guest that escapes into one — reads every cached tree, other owners' private images included.
The per-machine access check decides only what the service resolves and fetches for a caller.
The socket cannot tell one runner from another either, since the service checks no peer credentials on it, so what a caller can make the service do is bounded instead of attributed: a hold names only trees on disk, at most a thousand per call, and once holds keep the cache past half again its budget, it refuses every fetch, as a capacity problem, and logs an error for the operator.

**An install with no registry stages trees beside the cache's.** Local development has no registry for its own images, so the install stages each one as a tree with its launch record in the same node directory, named after the image reference (`image:stage-vm`), and a runner boots a staged tree before it asks the service.
A staged name never looks like a cache entry's, which is named by digest, so eviction never takes one and a reference that would turn into an entry's name is refused.
The service still runs there; it preloads nothing it can reach, and backs off.
