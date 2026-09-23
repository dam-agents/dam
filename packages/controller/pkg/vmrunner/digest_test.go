// TEST_OVERVIEW: the image cache keyed by digest. What must hold: an entry is named by the digest of the image it holds, so two tags of one image share one tree; a tag is resolved again once its resolution is older than refFresh, so a tag that moved boots the new image on the next create, while a machine already running the old image keeps its tree held; a pinned digest is never resolved; a registry that cannot answer boots the digest the tag last resolved to; entries from the first format, named after the reference, still boot when the digest root cannot serve a create; and the digest root is invisible to the patterns a release before it evicts with, so an old runner sharing the directory cannot delete a tree a new runner's guest has mounted.
package vmrunner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// UNIT_BOUNDARY_DESCRIPTION: a crane whose tags resolve to whatever digest the file names, so a test can move a tag between two creates the way a push to a registry does.
func craneWithMovableTags(log, digest string) string {
	return "#!/bin/sh\n" +
		"echo \"$@\" >> " + log + "\n" +
		"if [ \"$1\" = digest ]; then cat " + digest + "; exit 0; fi\n" +
		"if [ \"$1\" = config ]; then\n" +
		"  printf '{\"config\":{\"Entrypoint\":[\"/entry\"],\"Cmd\":[\"serve\"],\"Env\":[\"PATH=/bin\"],\"WorkingDir\":\"/app\"}}'\n" +
		"  exit 0\n" +
		"fi\n" +
		"d=$(mktemp -d); echo \"$2\" > \"$d/hello\"; tar -cf - -C \"$d\" .\n"
}

func movableTags(t *testing.T, h *harness, digest string) (log, file string) {
	t.Helper()
	scratch := t.TempDir()
	log, file = filepath.Join(scratch, "log"), filepath.Join(scratch, "digest")
	require.NoError(t, os.WriteFile(file, []byte(digest), 0o644))
	crane := filepath.Join(scratch, "crane")
	require.NoError(t, os.WriteFile(crane, []byte(craneWithMovableTags(log, file)), 0o755))
	h.node.Crane = crane
	return log, file
}

func ageRef(t *testing.T, s *Server, ref string, age time.Duration) {
	t.Helper()
	at := time.Now().Add(-age)
	require.NoError(t, os.Chtimes(s.refPath(ref), at, at))
}

const (
	firstDigest  = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
	secondDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
)

// TEST_SCENARIO: an entry named after its reference is never refreshed, so a machine created from `:latest` a week after the tag moved still boots the image the tag named when it was first cached. Keyed by digest, a create whose resolution has gone stale asks the registry again and boots what the tag names now. The machine created before the push keeps running its own tree, and that tree stays held by the digest the machine recorded, although the tag no longer names it.
func TestATagThatMovedBootsTheNewImageAndKeepsTheOldOneHeld(t *testing.T) {
	h := newHarness(t)
	log, file := movableTags(t, h, firstDigest)
	s := spec(true)
	s.Image = "quay.io/x/vm:latest"

	_, err := h.client().Ensure(t.Context(), "agent-a", s)
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	first := h.node.digestPath(firstDigest)
	assert.Contains(t, h.calls(), "-I "+filepath.Join(first, rootfsDir))

	require.NoError(t, os.WriteFile(file, []byte(secondDigest), 0o644), "the tag is pushed again")
	ageRef(t, h.node, s.Image, refFresh+time.Minute)

	_, err = h.client().Ensure(t.Context(), "agent-b", s)
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-b").State)
	second := h.node.digestPath(secondDigest)
	assert.Contains(t, h.calls(), "-I "+filepath.Join(second, rootfsDir), "a stale resolution is asked again, and the new image is what boots")

	asked, err := os.ReadFile(log)
	require.NoError(t, err)
	assert.Contains(t, string(asked), "export quay.io/x/vm@"+secondDigest, "fetched under the digest the tag names now")

	old := time.Now().Add(-9 * time.Hour)
	require.NoError(t, os.Chtimes(first, old, old))
	h.node.evictImages(h.node.ImageDir, "", 1)
	assert.DirExists(t, first, "agent-a still runs the image the tag used to name, and its record holds that tree")
	assert.DirExists(t, second)
}

// TEST_SCENARIO: a burst of creates on one tag would otherwise ask the registry once per machine. Inside the window the index answers, with no registry round-trip at all, and the tag is resolved again only once the window has passed.
func TestAFreshResolutionBootsWithoutAskingTheRegistry(t *testing.T) {
	h := newHarness(t)
	log, _ := movableTags(t, h, firstDigest)
	s := spec(true)

	for _, id := range []string{"agent-a", "agent-b"} {
		_, err := h.client().Ensure(t.Context(), id, s)
		require.NoError(t, err)
		require.Equal(t, StateRunning, h.settle(t, id).State)
	}

	asked, err := os.ReadFile(log)
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(string(asked), "digest "), "two creates inside the window resolve the tag once: %s", asked)
}

// TEST_SCENARIO: two tags that name one image are one set of bytes, and under the first format they were two trees, each fetched and unpacked in full. Keyed by digest, the second tag finds the tree the first one fetched.
func TestTwoTagsOfOneImageShareOneTree(t *testing.T) {
	h := newHarness(t)
	log, _ := movableTags(t, h, firstDigest)

	for id, tag := range map[string]string{"agent-a": "quay.io/x/vm:1", "agent-b": "quay.io/x/vm:stable"} {
		s := spec(true)
		s.Image = tag
		_, err := h.client().Ensure(t.Context(), id, s)
		require.NoError(t, err)
		require.Equal(t, StateRunning, h.settle(t, id).State)
	}

	asked, err := os.ReadFile(log)
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(string(asked), "export "), "the second tag boots the tree the first one fetched: %s", asked)
	entries, err := os.ReadDir(filepath.Join(h.node.ImageDir, digestRoot))
	require.NoError(t, err)
	var trees []string
	for _, e := range entries {
		if digestEntry.MatchString(e.Name()) {
			trees = append(trees, e.Name())
		}
	}
	assert.Equal(t, []string{"sha256_" + strings.TrimPrefix(firstDigest, "sha256:")}, trees)
}

// TEST_SCENARIO: a reference pinned to a digest cannot move, so asking the registry what it names is a round-trip that can only give the answer the reference already gives. It is never resolved, and it boots the same entry a tag of that image would.
func TestAPinnedDigestIsNeverResolved(t *testing.T) {
	h := newHarness(t)
	log, _ := movableTags(t, h, secondDigest)
	s := spec(true)
	s.Image = "quay.io/x/vm@" + firstDigest

	_, err := h.client().Ensure(t.Context(), "agent-a", s)
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)

	asked, err := os.ReadFile(log)
	require.NoError(t, err)
	assert.NotContains(t, string(asked), "digest ", "the reference names its own digest")
	assert.Contains(t, h.calls(), "-I "+filepath.Join(h.node.digestPath(firstDigest), rootfsDir))
}

// TEST_SCENARIO: a registry that is down must not stop machines booting images already on disk, which the first format never needed a registry for. A tag whose resolution is stale and cannot be renewed boots the digest it last resolved to.
func TestARegistryThatCannotAnswerBootsTheLastResolution(t *testing.T) {
	h := newHarness(t)
	movableTags(t, h, firstDigest)
	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)

	broken := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(broken, []byte("#!/bin/sh\nexit 1\n"), 0o755))
	h.node.Crane = broken
	ageRef(t, h.node, spec(true).Image, refFresh+time.Minute)

	_, err = h.client().Ensure(t.Context(), "agent-b", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRunning, h.settle(t, "agent-b").State, "the registry being down does not fail a create the cache can serve")
	assert.Contains(t, h.calls(), "machine create -n agent-b -I "+filepath.Join(h.node.digestPath(firstDigest), rootfsDir))
}

// TEST_SCENARIO: an install that upgrades keeps the entries its earlier release wrote, named after the reference, and some of them may be the only copy it has. When the digest root cannot serve a create, because the registry cannot say what the tag names, such an entry still boots. No digest is recorded for that machine, so its spec's reference is what holds the entry.
func TestAnEntryUnderTheOldNamingStillBoots(t *testing.T) {
	h := newHarness(t)
	legacy := h.node.cachePath(spec(true).Image)
	require.NoError(t, os.MkdirAll(filepath.Join(legacy, rootfsDir), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(legacy, launchFile), []byte(`{"entrypoint":["/entry"],"cmd":["serve"]}`), 0o644))
	broken := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(broken, []byte("#!/bin/sh\nexit 1\n"), 0o755))
	h.node.Crane = broken

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	assert.Contains(t, h.calls(), "-I "+filepath.Join(legacy, rootfsDir))
	assert.Empty(t, h.node.recordedDigest("agent-a"), "no digest names the tree this machine boots")

	old := time.Now().Add(-9 * time.Hour)
	require.NoError(t, os.Chtimes(legacy, old, old))
	h.node.evictImages(h.node.ImageDir, "", 1)
	assert.DirExists(t, legacy, "the machine's spec still holds the entry it booted")
}

// TEST_SCENARIO: during a rollout old and new runners share one node directory. A runner from before the digest root matches entries only at the top of the directory, with patterns that cannot match a dot-prefixed name, so it can never count or evict a digest entry. A new runner's claims are published relative to the directory, so an old runner reading them spares what it can see, and a new runner still reads the bare names an old runner publishes.
func TestOldAndNewRunnersSharingADirectoryCannotTakeEachOthersTrees(t *testing.T) {
	images := t.TempDir()
	assert.False(t, cachedImage.MatchString(digestRoot), "an old runner's tree pattern does not see the digest root")
	assert.False(t, cachedArchive.MatchString(digestRoot), "nor does its archive pattern")
	assert.False(t, strings.HasPrefix(digestRoot, partialPrefix), "nor does its scratch-tree sweep")

	newer := cacheRunner(t, "runner-new", images)
	dir, err := newer.machineDir("agent-a")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, newer.recordDigest("agent-a", firstDigest))
	tree := newer.digestPath(firstDigest)
	require.NoError(t, os.MkdirAll(tree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(tree, "rootfs"), make([]byte, 4096), 0o644))

	older := cacheRunner(t, "runner-old", images)
	legacy := holdsImage(t, older, "agent-b", "quay.io/x/old:1")
	require.NoError(t, os.MkdirAll(filepath.Join(images, holdersDir), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(images, holdersDir, "runner-old"), []byte(filepath.Base(legacy)), 0o644))

	published, err := os.ReadFile(filepath.Join(images, holdersDir, "runner-new"))
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(digestRoot, filepath.Base(tree)), string(published), "the claim names the entry relative to the directory")
	assert.True(t, older.heldElsewhere(images)[tree], "an old runner joins that name to the directory and spares the entry it names")

	old := time.Now().Add(-9 * time.Hour)
	require.NoError(t, os.Chtimes(legacy, old, old))
	third := cacheRunner(t, "runner-third", images)
	third.evictImages(images, "", 1)
	assert.DirExists(t, legacy, "a new runner spares an entry an old runner claims by its bare name")
	assert.DirExists(t, tree, "and an entry a new runner claims under the digest root")
}

// TEST_SCENARIO: eviction takes trees and never references, so without its own pruning the index would grow by one file for every tag an install ever ran. A stale index file whose tree is gone is removed. One that is fresh or whose tree is still there is kept, because it still saves a create a registry round-trip.
func TestTheIndexForgetsTagsWhoseTreesAreGone(t *testing.T) {
	images := t.TempDir()
	s := cacheRunner(t, "runner-a", images)
	require.NoError(t, s.writeRef("quay.io/x/gone:1", firstDigest))
	require.NoError(t, s.writeRef("quay.io/x/kept:1", secondDigest))
	require.NoError(t, s.writeRef("quay.io/x/fresh:1", firstDigest))
	require.NoError(t, os.MkdirAll(s.digestPath(secondDigest), 0o755))
	ageRef(t, s, "quay.io/x/gone:1", refFresh+time.Minute)
	ageRef(t, s, "quay.io/x/kept:1", refFresh+time.Minute)

	s.evictImages(images, "", 1<<30)

	assert.NoFileExists(t, s.refPath("quay.io/x/gone:1"))
	assert.FileExists(t, s.refPath("quay.io/x/kept:1"), "its tree is still there, and a registry outage would boot it")
	assert.FileExists(t, s.refPath("quay.io/x/fresh:1"), "and a fresh resolution still saves a round-trip")
}

// TEST_SCENARIO: the first format escaped a reference into a name, and two references could escape to the same one. An index keyed that way would boot one image under the other's name. The index is keyed by a hash of the whole reference, and a record that names a different reference is not believed.
func TestTheIndexNeverAnswersForAnotherReference(t *testing.T) {
	s := cacheRunner(t, "runner-a", t.TempDir())
	assert.Equal(t, s.cachePath("quay.io/a/b:1"), s.cachePath("quay.io/a_b:1"), "the first format names both references alike")
	assert.NotEqual(t, s.refPath("quay.io/a/b:1"), s.refPath("quay.io/a_b:1"), "the index does not")

	require.NoError(t, s.writeRef("quay.io/a/b:1", firstDigest))
	require.NoError(t, os.Rename(s.refPath("quay.io/a/b:1"), s.refPath("quay.io/a_b:1")))
	digest, _ := s.readRef("quay.io/a_b:1")
	assert.Empty(t, digest, "a record naming another reference is not believed")
}

// TEST_SCENARIO: the digest is taken off a reference only when it names one this cache can key an entry by, and the repository is what the reference names without its tag or digest. A registry port is not a tag.
func TestAReferenceIsTakenApartIntoRepositoryAndDigest(t *testing.T) {
	assert.Equal(t, firstDigest, pinnedDigest("quay.io/x/vm@"+firstDigest))
	assert.Equal(t, firstDigest, pinnedDigest("quay.io/x/vm:1@"+firstDigest), "a tag beside a digest is ignored")
	assert.Empty(t, pinnedDigest("quay.io/x/vm:1"))
	assert.Empty(t, pinnedDigest("quay.io/x/vm@sha512:abc"), "a digest this cache cannot name an entry by")

	assert.Equal(t, "quay.io/x/vm", repository("quay.io/x/vm:1"))
	assert.Equal(t, "quay.io/x/vm", repository("quay.io/x/vm@"+firstDigest))
	assert.Equal(t, "localhost:5000/vm", repository("localhost:5000/vm:1"))
	assert.Equal(t, "localhost:5000/vm", repository("localhost:5000/vm"))
}
