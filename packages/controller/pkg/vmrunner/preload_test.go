// TEST_OVERVIEW: the per-node image cache service, which exists before any agent does. What must hold: the harness images an install ships are fetched and unpacked into the node's shared directory without a machine asking for them, and the runner that later boots one of them touches no registry; an image preloaded for nobody survives the eviction that would otherwise take it first, because it is held by no machine and is the oldest write; that protection lasts exactly as long as the service refreshes it, so a service that is gone stops pinning; the service prunes the directory on its own schedule, which nothing did before — a runner tidies it only as a side effect of paying for a miss; and it evicts under the same rule the runners do, so it never takes a tree a running guest has mounted as its root filesystem.
package vmrunner

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// UNIT_BOUNDARY_DESCRIPTION: a service over the node directory the test's runners share, with a crane that records every call — so a test can say not only what ended up in the cache but whether anything was fetched to put it there.
func preloadService(t *testing.T, images string, refs ...string) (*Preloader, string) {
	t.Helper()
	fetches := filepath.Join(t.TempDir(), "fetches")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(fetches)), 0o755))
	return &Preloader{ImageDir: images, Images: refs, ID: "image-cache", Budget: 1 << 30, Crane: crane, Every: time.Minute}, fetches
}

// UNIT_BOUNDARY_DESCRIPTION: a tree in the cache that nothing put there through the service or a runner — an image left behind by an owner whose runner has since been removed, which is the state a shared node directory drifts into.
func strayTree(t *testing.T, images, name string) string {
	t.Helper()
	dir := filepath.Join(images, name)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "rootfs"), make([]byte, 1<<20), 0o644))
	return dir
}

// TEST_SCENARIO: nothing can pay for an image ahead of time today, because a runner exists only once one of its owner's agents needs one — so the first machine on an image, on every node and after every deploy, waits out the fetch and the unpack with a user on the other end. The service is there before any agent: it leaves the tree and what the image says to run, and the runner that then creates the machine reaches no registry at all.
func TestAnImageIsPreloadedBeforeAnyAgentAsksForIt(t *testing.T) {
	h := newHarness(t)
	service, preloaded := preloadService(t, h.node.ImageDir, spec(true).Image)

	service.Sweep()

	cached := filepath.Join(h.node.ImageDir, "quay.io_x_vm_1")
	require.FileExists(t, filepath.Join(cached, rootfsDir, "hello"), "the tree every machine of this image will share")
	require.FileExists(t, filepath.Join(cached, launchFile), "and what the image says to run, which the tree does not carry")
	require.FileExists(t, preloaded, "which was fetched, since nothing had cached it")

	fetches := filepath.Join(t.TempDir(), "fetches")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(fetches)), 0o755))
	h.node.Crane = crane

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "agent-a")

	assert.Equal(t, StateRunning, st.State, "the first machine on this image boots from what was already there")
	assert.NoFileExists(t, fetches, "and pays for no fetch of its own, which is the whole of what preloading buys")
	assert.Contains(t, h.calls(), "-I "+filepath.Join(cached, rootfsDir), "the preloaded tree is the one smolvm is handed")
}

// TEST_SCENARIO: eviction spares an image some machine is running and nothing else, and it takes the oldest write first. An image preloaded for nobody is both — held by no machine, and written before any of the images the agents that came later needed. Without a claim of its own it would be the first thing deleted, which would make preloading useless the moment the cache came under pressure.
func TestAPreloadedImageIsNotTheFirstThingEvicted(t *testing.T) {
	images := t.TempDir()
	service, _ := preloadService(t, images, "quay.io/x/preloaded:1")
	service.Sweep()

	preloaded := filepath.Join(images, "quay.io_x_preloaded_1")
	require.DirExists(t, preloaded)
	oldest := time.Now().Add(-9 * time.Hour)
	require.NoError(t, os.Chtimes(preloaded, oldest, oldest), "and nothing in this directory is older")
	stray := strayTree(t, images, "quay.io_x_stray_2")

	cacheRunner(t, "runner-a", images).evictImages(images, "", 1)

	assert.DirExists(t, preloaded, "no machine holds it, and it must still be here when the first one wants it")
	assert.NoDirExists(t, stray, "what nobody claims is what the budget takes")
}

// TEST_SCENARIO: a claim that never expired would pin a tree forever after the service that made it was removed — an install turning preloading off, or a node the DaemonSet no longer runs on, would leave images nothing can reclaim. The claim is therefore believed only while it is being refreshed, the same lease the runners' claims are on.
func TestAPreloadStopsPinningOnceTheServiceStopsRefreshingIt(t *testing.T) {
	images := t.TempDir()
	service, _ := preloadService(t, images, "quay.io/x/preloaded:1")
	service.Sweep()

	preloaded := filepath.Join(images, "quay.io_x_preloaded_1")
	require.DirExists(t, preloaded)
	claim := filepath.Join(images, holdersDir, "image-cache")
	expired := time.Now().Add(-holderStale - time.Minute)
	require.NoError(t, os.Chtimes(claim, expired, expired))

	cacheRunner(t, "runner-a", images).evictImages(images, "", 1)

	assert.NoDirExists(t, preloaded, "the service that wanted it kept is gone, so the budget may have it back")
	assert.NoFileExists(t, claim, "and the claim goes with it rather than being re-read on every eviction")
}

// TEST_SCENARIO: a runner prunes the node's directory only as a side effect of paying for a fetch, so a node whose images are all cached prunes nothing — and with a host directory outliving every runner on the node, an image left by an owner who has gone sits there indefinitely. The service sweeps on every pass instead, whether or not it had anything to fetch.
func TestTheServicePrunesTheNodeDirectoryWithoutFetchingAnything(t *testing.T) {
	images := t.TempDir()
	service, fetches := preloadService(t, images, "quay.io/x/preloaded:1")
	service.Sweep()

	preloaded := filepath.Join(images, "quay.io_x_preloaded_1")
	require.DirExists(t, preloaded)
	departed := strayTree(t, images, "quay.io_x_departed_1")
	require.NoError(t, os.Remove(fetches), "the fetch that preloading cost is not the one this pass is about")
	service.Budget = 4096

	service.Sweep()

	assert.NoDirExists(t, departed, "no runner on this node claims it, and nothing else would ever have removed it")
	assert.DirExists(t, preloaded, "while the image this install ships stays")
	assert.NoFileExists(t, fetches, "and the pass that reclaimed the space fetched nothing: what it keeps was already unpacked")
}

// TEST_SCENARIO: the service is a second process evicting from a directory the runners' guests have mounted as their root filesystems, which is the one thing eviction must never take. It reads the runners' published claims exactly as they read each other's — a runner knows only its own machines, and the service knows none at all.
func TestTheServiceNeverEvictsAnImageARunnersMachineIsRunning(t *testing.T) {
	images := t.TempDir()
	runner := cacheRunner(t, "runner-a", images)
	held := holdsImage(t, runner, "agent-a", "quay.io/x/held:1")
	runner.publishHolders()

	service, _ := preloadService(t, images, "quay.io/x/preloaded:1")
	service.Budget = 1
	service.Sweep()

	assert.DirExists(t, held, "another process's guest has this tree open as its root filesystem")
	assert.DirExists(t, filepath.Join(images, "quay.io_x_preloaded_1"), "and the image this install ships is kept over the budget rather than fetched again next time")
}

// TEST_SCENARIO: the service is not in the boot path — a machine reads the tree out of the directory itself. So a service that is down costs an install nothing it had before: images already cached still boot, and an image nobody preloaded is still fetched by the runner that needs it, which is the only path a custom agent image can ever take.
func TestAMachineBootsFromThePreloadedTreeWithTheServiceGone(t *testing.T) {
	h := newHarness(t)
	service, _ := preloadService(t, h.node.ImageDir, spec(true).Image)
	service.Sweep()
	require.NoError(t, os.RemoveAll(filepath.Join(h.node.ImageDir, holdersDir)), "the service and every trace of it")

	fetches := filepath.Join(t.TempDir(), "fetches")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(fetches)), 0o755))
	h.node.Crane = crane

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRunning, h.settle(t, "agent-a").State, "the tree is read from the directory, not asked for")
	assert.NoFileExists(t, fetches, "so a cached image costs no registry call even with nothing left to preload it")

	custom := spec(true)
	custom.Image = "quay.io/x/nobody-preloads-this:7"
	_, err = h.client().Ensure(t.Context(), "agent-b", custom)
	require.NoError(t, err)
	assert.Equal(t, StateRunning, h.settle(t, "agent-b").State)
	assert.FileExists(t, fetches, "and a miss is still the runner's own to fill, which is what keeps custom images working")
}

// UNIT_BOUNDARY_DESCRIPTION: a crane whose first fetch stands in for one that ran long. It backdates the service's own claim exactly once, which is what the passing of more than holderStale would do while a pass was still working through its list.
func craneAgeingTheClaim(log, holders, marker string) string {
	return "#!/bin/sh\n" +
		"echo \"$@\" >> " + log + "\n" +
		"if [ \"$1\" = config ]; then\n" +
		"  if [ -f " + holders + " ] && [ ! -f " + marker + " ]; then touch -d @1 " + holders + "; : > " + marker + "; fi\n" +
		"  printf '{\"config\":{\"Entrypoint\":[\"/entry\"],\"Cmd\":[\"serve\"],\"Env\":[\"PATH=/bin\"],\"WorkingDir\":\"/app\"}}'\n" +
		"  exit 0\n" +
		"fi\n" +
		"d=$(mktemp -d); echo rootfs > \"$d/hello\"; tar -cf - -C \"$d\" .\n"
}

// TEST_SCENARIO: a claim is believed only while it is refreshed, and a pass is not quick — every image is allowed a whole pull timeout, so a pass over several of them can run longer than the window a runner believes a claim for. Refreshed only between passes, this service's claim would go stale during the very pass that wrote it: a peer runner would delete the file as a dead process's, and the images already preloaded would be the first thing evicted under pressure — the head start thrown away by the pass still buying it.
func TestALongPassKeepsTheClaimItIsStillWriting(t *testing.T) {
	images := t.TempDir()
	scratch := t.TempDir()
	crane := filepath.Join(scratch, "crane")
	holders := filepath.Join(images, holdersDir, "image-cache")
	require.NoError(t, os.WriteFile(crane, []byte(craneAgeingTheClaim(
		filepath.Join(scratch, "log"), holders, filepath.Join(scratch, "aged"))), 0o755))
	service := &Preloader{
		ImageDir: images, Images: []string{"quay.io/x/first:1", "quay.io/x/second:1"},
		ID: "image-cache", Budget: 1 << 30, Crane: crane, Every: time.Minute,
	}

	service.Sweep()

	require.FileExists(t, filepath.Join(scratch, "aged"), "the pass has to have been aged mid-flight, or this proves nothing")
	peer := &Server{ImageDir: images, RunnerID: "runner-b"}
	held := peer.heldElsewhere(images)
	assert.FileExists(t, holders, "a peer runner reads a stale claim as a dead process's and deletes it")
	for _, ref := range service.Images {
		assert.True(t, held[service.cache().cachePath(ref)],
			"a runner wanting room must still see %s as claimed, though the pass that claimed it outlived one lease window", ref)
	}
}

// TEST_SCENARIO: a fetch unpacks beside the entry it will become and removes that scratch tree on its way out, which a killed process never reaches — and the service is killed routinely, because a redeploy rolls the DaemonSet and a redeploy is exactly what makes it fetch new tags. What is left is worse than orphaned: its name is dot-prefixed, so neither the pattern that counts an entry against the budget nor the one that picks an entry to evict can match it, and the bytes sit in a host directory that outlives every pod. So the directory's own housekeeping has to reclaim them, while leaving alone a tree some other process on the node is still unpacking into.
func TestTheSweepReclaimsWhatAKilledFetchLeftBehind(t *testing.T) {
	images := t.TempDir()
	service, _ := preloadService(t, images)

	abandoned := filepath.Join(images, partialPrefix+"abandoned")
	require.NoError(t, os.MkdirAll(abandoned, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(abandoned, "half"), make([]byte, 1<<20), 0o644))
	old := time.Now().Add(-2 * partialStale)
	require.NoError(t, os.Chtimes(abandoned, old, old))

	running := filepath.Join(images, partialPrefix+"running")
	require.NoError(t, os.MkdirAll(running, 0o755))

	service.Sweep()

	assert.NoDirExists(t, abandoned, "no fetch runs for twice its own timeout, so these bytes were nobody's and nothing else could see them")
	assert.DirExists(t, running, "a fetch another process on this node is still unpacking into keeps its scratch tree")
}
