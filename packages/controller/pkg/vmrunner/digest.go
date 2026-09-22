package vmrunner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// UNIT_BOUNDARY_DESCRIPTION: the root of the cache's second format, where an entry is named by the digest of the image it holds instead of by the reference that asked for it. The version is in the name so a later format can take a new root beside this one. The root is dot-prefixed so neither pattern an earlier release matches entries with can match it: a runner from before this format never counts it against its budget, never evicts it, and never prunes inside it. That is what keeps a mixed-version node safe. An old runner cannot delete a tree a new runner's guest has mounted, whatever it reads or fails to read in the holders directory.
	digestRoot = ".v2"
	// UNIT_BOUNDARY_DESCRIPTION: the index from a reference to the digest it last resolved to, one small file per reference, inside the digest root. The file's mtime is when that resolution was made.
	refsDir = "refs"
	// UNIT_BOUNDARY_DESCRIPTION: the digest a machine was created from, kept in the machine's own directory. The spec keeps the reference the controller asked for, because drift is judged against that reference. A tag does not say which tree a machine has mounted once the tag has moved, so eviction reads this file instead.
	imageDigestFile = "image-digest"
	// UNIT_BOUNDARY_DESCRIPTION: how long a tag's resolution is trusted without asking the registry again. Inside the window a create on that tag boots the cached tree with no registry round-trip, so a burst of machines on one image asks once. Past it the tag is resolved again, so a tag that moved is picked up by the next machine created after the window. The preloader resolves its tags on every pass, which is well inside the window, so an image an install ships is almost never resolved on the create path.
	refFresh = 10 * time.Minute
	// UNIT_BOUNDARY_DESCRIPTION: a resolution is a manifest HEAD and nothing else. A registry that has not answered in a minute is treated as down, so the create falls back to the last digest the tag resolved to rather than waiting for the pull timeout.
	resolveTimeout = time.Minute
)

var imageDigest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

var digestEntry = regexp.MustCompile(`^sha256_[a-f0-9]{64}$`)

func pinnedDigest(ref string) string {
	if _, digest, ok := strings.Cut(ref, "@"); ok && imageDigest.MatchString(digest) {
		return digest
	}
	return ""
}

func repository(ref string) string {
	name, _, _ := strings.Cut(ref, "@")
	if colon := strings.LastIndex(name, ":"); colon > strings.LastIndex(name, "/") {
		name = name[:colon]
	}
	return name
}

func (s *Server) digestPath(digest string) string {
	return filepath.Join(s.ImageDir, digestRoot, strings.Replace(digest, ":", "_", 1))
}

// UNIT_BOUNDARY_DESCRIPTION: an index file is named by a hash of the whole reference, not by the escaping entries of the first format used. That escaping maps two different references to one name, for example quay.io/a/b:1 and quay.io/a_b:1. In an index, one name for two references would boot one image's digest for the other image.
func (s *Server) refPath(ref string) string {
	sum := sha256.Sum256([]byte(ref))
	return filepath.Join(s.ImageDir, digestRoot, refsDir, hex.EncodeToString(sum[:]))
}

type refRecord struct {
	Ref    string `json:"ref"`
	Digest string `json:"digest"`
}

// UNIT_BOUNDARY_DESCRIPTION: the digest this reference last resolved to on this directory, and when. The record names its own reference, and a record that names another reference is not believed, so a hash collision or a hand-edited file cannot boot the wrong image.
func (s *Server) readRef(ref string) (string, time.Time) {
	path := s.refPath(ref)
	info, err := os.Stat(path)
	if err != nil {
		return "", time.Time{}
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return "", time.Time{}
	}
	var record refRecord
	if json.Unmarshal(body, &record) != nil || record.Ref != ref || !imageDigest.MatchString(record.Digest) {
		return "", time.Time{}
	}
	return record.Digest, info.ModTime()
}

func (s *Server) writeRef(ref, digest string) error {
	path := s.refPath(ref)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.Marshal(refRecord{Ref: ref, Digest: digest})
	if err != nil {
		return err
	}
	staged, err := os.CreateTemp(filepath.Dir(path), ".new-*")
	if err != nil {
		return err
	}
	defer os.Remove(staged.Name())
	if _, err := staged.Write(body); err != nil {
		staged.Close()
		return err
	}
	if err := staged.Close(); err != nil {
		return err
	}
	if err := os.Chmod(staged.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(staged.Name(), path)
}

// UNIT_BOUNDARY_DESCRIPTION: the digest a known reference names. A pinned reference names its digest itself. A tag names the digest it last resolved to, however long ago that was. It is what an entry is held under by something that only knows the reference.
func (s *Server) knownDigest(ref string) string {
	if digest := pinnedDigest(ref); digest != "" {
		return digest
	}
	digest, _ := s.readRef(ref)
	return digest
}

// UNIT_BOUNDARY_DESCRIPTION: the digest a machine created now from this reference should boot. A pinned reference is never resolved, because it cannot move. A tag resolved within fresh is taken from the index. Otherwise the registry is asked, and the answer is written to the index for every process on the directory. If the registry cannot answer, the last digest the tag resolved to is used, so a registry outage boots what was cached before. An empty answer means the tag was never resolved here and cannot be resolved now. The caller then falls back to the first format.
func (s *Server) resolveDigest(ref string, fresh time.Duration) string {
	if digest := pinnedDigest(ref); digest != "" {
		return digest
	}
	known, at := s.readRef(ref)
	if known != "" && time.Since(at) < fresh {
		return known
	}
	if s.Crane == "" {
		return known
	}
	ctx, cancel := context.WithTimeout(s.lifetime(), resolveTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, s.Crane, "digest", ref).Output()
	digest := strings.TrimSpace(string(out))
	logged := strings.NewReplacer("\n", " ", "\r", " ").Replace(ref)
	if err != nil || !imageDigest.MatchString(digest) {
		if known != "" {
			slog.Warn("image cache: the registry could not resolve a tag, so it boots the digest the tag last resolved to", "image", logged, "digest", known)
		}
		return known
	}
	if err := s.writeRef(ref, digest); err != nil {
		slog.Warn("image cache: cannot record what a tag resolved to", "image", logged, "error", err)
	}
	return digest
}

// UNIT_BOUNDARY_DESCRIPTION: the tree a machine of this digest boots, fetched into the digest root if it is not there. The fetch names the digest and not the tag, so the tree is the image the digest names even if the tag moves while the fetch runs. No answer, with no error, means this format cannot serve the create: no digest was known, or there is no crane to fetch with. The caller then tries the first format.
func (s *Server) digestImage(forMachine, ref, digest string) (string, *ImageLaunch, error) {
	if digest == "" {
		return "", nil, nil
	}
	entry := s.digestPath(digest)
	launch, err := readLaunch(entry)
	if err != nil {
		return "", nil, err
	}
	if launch == nil && s.Crane != "" {
		if err := s.cacheImage(repository(ref)+"@"+digest, entry, forMachine); err != nil {
			return "", nil, err
		}
		if launch, err = readLaunch(entry); err != nil {
			return "", nil, err
		}
	}
	if launch == nil {
		return "", nil, nil
	}
	return filepath.Join(entry, rootfsDir), launch, nil
}

// UNIT_BOUNDARY_DESCRIPTION: records the digest a machine is about to boot before it boots, and publishes it. A machine that started with no record is a machine whose tree another runner may evict. With no digest the record is removed: that machine boots from the first format, and its spec's reference already holds that entry.
func (s *Server) recordDigest(id, digest string) error {
	dir, err := s.machineDir(id)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, imageDigestFile)
	if digest == "" {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.WriteFile(path, []byte(digest), 0o644); err != nil {
		return fmt.Errorf("recording the image a machine boots: %w", err)
	}
	s.publishHolders()
	return nil
}

func (s *Server) recordedDigest(id string) string {
	dir, err := s.machineDir(id)
	if err != nil {
		return ""
	}
	body, err := os.ReadFile(filepath.Join(dir, imageDigestFile))
	if err != nil {
		return ""
	}
	if digest := strings.TrimSpace(string(body)); imageDigest.MatchString(digest) {
		return digest
	}
	return ""
}

// UNIT_BOUNDARY_DESCRIPTION: an index file outlives the tree it points at, because eviction takes trees and not references. A file whose tree is gone still saves a round-trip while it is fresh. After that it only saves a create that could not fetch the tree anyway, so it is removed. This keeps the index from growing without bound on a directory that outlives every runner.
func pruneRefs(dir string) {
	refs := filepath.Join(dir, digestRoot, refsDir)
	entries, err := os.ReadDir(refs)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(refs, e.Name())
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) <= refFresh {
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var record refRecord
		if json.Unmarshal(body, &record) == nil && imageDigest.MatchString(record.Digest) {
			entry := filepath.Join(dir, digestRoot, strings.Replace(record.Digest, ":", "_", 1))
			if _, err := os.Stat(entry); err == nil {
				continue
			}
		}
		_ = os.Remove(path)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an entry in the first format, named after the reference: a tree with its launch beside it, or an archive an earlier release cached. This release reads these entries and never writes them. A machine boots from one only when the digest root cannot serve it: the tag cannot be resolved, there is no crane to fetch with, or the fetch failed. They are not moved into the digest root, because a guest of an older runner may have one mounted, and that runner holds it by its old name. Once nothing holds one, eviction takes it like any other entry.
func (s *Server) legacyImage(ref string) (string, *ImageLaunch, error) {
	base := s.cachePath(ref)
	launch, err := readLaunch(base)
	if err != nil {
		return "", nil, err
	}
	if launch != nil {
		return filepath.Join(base, rootfsDir), launch, nil
	}
	archive := base + ".tar"
	if _, err := os.Stat(archive); err != nil {
		return "", nil, nil
	}
	if launch, err = launchFromArchive(archive); err != nil {
		return "", nil, fmt.Errorf("%w: %w", errImageUnusable, err)
	}
	return archive, launch, nil
}
