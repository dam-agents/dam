package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TEST_OVERVIEW: platform-init is what makes a machine's persistence the platform's promise rather than the image's behaviour. The mounting itself needs a guest, but everything that decides what ends up on the disk — seeding a declared path from the image exactly once, never leaving a half-copy behind, keeping the boot log readable, resolving the entrypoint it hands off to — is ordinary file work and is covered here.

func TestSeedingReproducesTheImageTree(t *testing.T) {
	image := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(image, "work", "nested"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(image, "work", "nested", "file"), []byte("baked"), 0o640))
	require.NoError(t, os.Chmod(filepath.Join(image, "work", "nested", "file"), 0o640))
	require.NoError(t, os.Symlink("nested/file", filepath.Join(image, "work", "link")))
	require.NoError(t, os.Mkdir(filepath.Join(image, "shared"), 0o755))
	require.NoError(t, os.Chmod(filepath.Join(image, "shared"), 0o2775|fs.ModeSetgid|fs.ModeSticky))

	store := filepath.Join(t.TempDir(), "agent", "home", "agent")
	require.NoError(t, seed(image, store))

	body, err := os.ReadFile(filepath.Join(store, "work", "nested", "file"))
	require.NoError(t, err)
	assert.Equal(t, "baked", string(body))

	info, err := os.Stat(filepath.Join(store, "work", "nested", "file"))
	require.NoError(t, err)
	assert.Equal(t, fs.FileMode(0o640), info.Mode().Perm(), "a mode the image set is a mode the agent keeps")

	info, err = os.Stat(filepath.Join(store, "shared"))
	require.NoError(t, err)
	assert.Equal(t, fs.ModeDir|fs.ModeSetgid|fs.ModeSticky|0o2775&fs.ModePerm, info.Mode()&(fs.ModeDir|fs.ModeSetgid|fs.ModeSticky|fs.ModePerm),
		"setgid, sticky and group-write survive the umask this process inherited; seeding happens once, so a bit dropped here never comes back")

	target, err := os.Readlink(filepath.Join(store, "work", "link"))
	require.NoError(t, err)
	assert.Equal(t, "nested/file", target, "a symlink is reproduced, not followed and copied")
}

// TEST_SCENARIO: an Agent may persist a path its image never shipped. That is an empty directory on the disk, not a failed boot.
func TestSeedingAPathTheImageDoesNotShipStartsEmpty(t *testing.T) {
	store := filepath.Join(t.TempDir(), "agent", "data")
	require.NoError(t, seed(filepath.Join(t.TempDir(), "absent"), store))

	entries, err := os.ReadDir(store)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

// TEST_SCENARIO: seeding happens once, on the boot that finds no store. A store that already holds the agent's work must never be overwritten by the image again — that would discard everything the agent has done since it was created.
func TestSeedingLeavesAnExistingStoreAlone(t *testing.T) {
	image := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(image, "file"), []byte("from the image"), 0o644))

	root := t.TempDir()
	store := filepath.Join(root, "agent", "home", "agent")
	require.NoError(t, seed(image, store))
	require.NoError(t, os.WriteFile(filepath.Join(store, "file"), []byte("the agent's work"), 0o644))

	_, err := os.Stat(store)
	require.NoError(t, err, "the store exists, so a second boot never calls seed at all")

	body, err := os.ReadFile(filepath.Join(store, "file"))
	require.NoError(t, err)
	assert.Equal(t, "the agent's work", string(body))
}

// TEST_SCENARIO: a boot cut short halfway through the copy must leave nothing a later boot could mistake for a complete store. The copy is staged beside its destination and renamed into place, so an interrupted seed leaves only the staging directory and the next boot seeds again from the image.
func TestAnInterruptedSeedIsNotMistakenForAStore(t *testing.T) {
	root := t.TempDir()
	store := filepath.Join(root, "agent", "home", "agent")
	staged := store + ".seeding"
	require.NoError(t, os.MkdirAll(staged, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(staged, "half"), []byte("partial"), 0o644))

	image := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(image, "whole"), []byte("complete"), 0o644))
	require.NoError(t, seed(image, store))

	assert.FileExists(t, filepath.Join(store, "whole"))
	assert.NoFileExists(t, filepath.Join(store, "half"), "the abandoned staging directory is discarded, not adopted")
}

// TEST_SCENARIO: a failure shows at the end of a log, so the cap on the previous boot trims its start. Trimming the whole file, or keeping the head, would throw away the only record of why a machine died.
func TestTheBootLogCapKeepsTheEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-runtime.log")
	require.NoError(t, os.WriteFile(path, []byte("older than the cap"+strings.Repeat("x", 100)+"the failure"), 0o644))

	keepTail(path, 11)

	body, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "the failure", string(body))
}

func TestAShortBootLogIsLeftAlone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-runtime.log")
	require.NoError(t, os.WriteFile(path, []byte("short"), 0o644))

	keepTail(path, 1<<20)

	body, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "short", string(body))
}

// TEST_SCENARIO: an image's launch record may name a bare command, which a container runtime resolves against PATH. Refusing one would fail a machine on an entrypoint that works everywhere else.
func TestTheImageEntrypointIsResolvedLikeAShellWould(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "harness"), []byte("#!/bin/sh\n"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes"), []byte("data"), 0o644))
	t.Setenv("PATH", dir)

	resolved, err := lookPath("harness")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, "harness"), resolved)

	_, err = lookPath("notes")
	assert.Error(t, err, "a file on PATH that nobody can run is not the entrypoint")

	resolved, err = lookPath(filepath.Join(dir, "harness"))
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, "harness"), resolved, "an absolute entrypoint is taken as given")
}
