// UNIT_BOUNDARY_DESCRIPTION: the entrypoint of every vm-backend machine. It claims the machine's storage disk, applies the mount plan its runner wrote, and execs the image's own entrypoint. It exists so persistence is the platform's to guarantee rather than the image's to implement: the shell that did this before lived in the agent base image, so a machine booted from any other image came up with its disk unmounted and lost every byte the first time it stopped — silently, because the check that would have caught it lived in the same entrypoint that was missing. The runner supplies this binary along with the plan, so an image that has never heard of this platform still persists exactly what its Agent declared.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"

	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

const (
	bootLogCap    = 32 << 20
	trustCacheEnv = "PLATFORM_TRUST_CACHE"
	bootLogName   = "agent-runtime.log"
	// UNIT_BOUNDARY_DESCRIPTION: what a container runtime searches when an image names a bare command and its config sets no PATH. Without this an image that boots as a container would fail as a machine, on nothing but the absence of a variable it never had to set.
	defaultPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
)

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "platform-init: "+format+"\n", args...)
}

// UNIT_BOUNDARY_DESCRIPTION: every caller is a condition under which the guest would come up without its persisted paths. An agent that runs and quietly discards its work looks healthy until the machine stops, so a machine that cannot persist does not boot at all.
func fatal(format string, args ...any) {
	logf("FATAL: "+format, args...)
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		fatal("no image entrypoint to exec; the runner passes it after this binary")
	}
	command := os.Args[1:]

	plan := readPlan()
	root := claimDisk()
	openBootLog(root)

	logf("storage disk claimed at %s", root)
	bindCA()
	for _, path := range plan.Persist {
		persist(root, path)
	}
	offerTrustCache(root)

	binary, err := lookPath(command[0])
	if err != nil {
		fatal("the image's entrypoint %q is not executable in this guest: %v", command[0], err)
	}
	logf("handing off to the image entrypoint %v", command)
	if err := syscall.Exec(binary, command, os.Environ()); err != nil {
		fatal("exec %s: %v", binary, err)
	}
}

func readPlan() vmrunner.Plan {
	encoded, err := os.ReadFile(vmrunner.PlanPath)
	if err != nil {
		fatal("reading the mount plan at %s: %v", vmrunner.PlanPath, err)
	}
	var plan vmrunner.Plan
	if err := json.Unmarshal(encoded, &plan); err != nil {
		fatal("parsing the mount plan: %v", err)
	}
	return plan
}

// UNIT_BOUNDARY_DESCRIPTION: a disk that failed to attach leaves an ordinary directory of the root overlay in its place, which would take every write the plan makes and discard it at the next stop — so the device is checked before anything is mounted onto it. The move that follows is what leaves the disk reachable by exactly one name: left where the VMM put it, its root is writable under a name that means something else here, and anything written straight to it persists outside the plan. A kernel that refuses the move still has a working disk, which is worth a line in the log and not a failed boot.
func claimDisk() string {
	device, err := os.Stat(vmrunner.DiskDevicePath)
	if err != nil {
		fatal("no storage disk at %s: %v", vmrunner.DiskDevicePath, err)
	}
	root, err := os.Stat("/")
	if err != nil {
		fatal("stat /: %v", err)
	}
	if sameDevice(device, root) {
		fatal("%s is on the root filesystem, so this machine has no storage disk; refusing to boot without persistence",
			vmrunner.DiskDevicePath)
	}
	if err := os.MkdirAll(vmrunner.DiskPath, 0o755); err != nil {
		logf("WARNING: creating %s (%v); keeping the disk at %s", vmrunner.DiskPath, err, vmrunner.DiskDevicePath)
		return vmrunner.DiskDevicePath
	}
	if err := syscall.Mount(vmrunner.DiskDevicePath, vmrunner.DiskPath, "", syscall.MS_MOVE, ""); err != nil {
		logf("WARNING: moving the disk to %s (%v); keeping it at %s, where it stays writable under that name too",
			vmrunner.DiskPath, err, vmrunner.DiskDevicePath)
		return vmrunner.DiskDevicePath
	}
	_ = os.Remove(vmrunner.DiskDevicePath)
	return vmrunner.DiskPath
}

func sameDevice(a, b fs.FileInfo) bool {
	left, leftOK := a.Sys().(*syscall.Stat_t)
	right, rightOK := b.Sys().(*syscall.Stat_t)
	return leftOK && rightOK && left.Dev == right.Dev
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's console goes nowhere — stdout and stderr in the guest are both /dev/null — so without this a guest that dies explains itself to nobody. Pointing both at the disk this early puts the whole boot in the record, not only the part after the harness starts. Each boot starts a fresh file and moves the one before it aside, so the history is one boot deep: enough that a machine which died still explains itself on the boot after. Nothing bounds the boot being written, so an agent that logs without pause can still fill its disk and only the boot after it trims.
func openBootLog(root string) {
	dir := vmrunner.SystemStore(root, "log")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logf("WARNING: no boot log directory (%v); this machine's output stays discarded", err)
		return
	}
	path := filepath.Join(dir, bootLogName)
	previous := path + ".prev"
	if err := os.Rename(path, previous); err != nil && !errors.Is(err, fs.ErrNotExist) {
		logf("WARNING: rotating the boot log (%v)", err)
	}
	keepTail(previous, bootLogCap)

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		logf("WARNING: opening the boot log (%v); this machine's output stays discarded", err)
		return
	}
	defer file.Close()
	for _, fd := range []int{syscall.Stdout, syscall.Stderr} {
		if err := syscall.Dup3(int(file.Fd()), fd, 0); err != nil {
			logf("WARNING: redirecting fd %d to the boot log (%v)", fd, err)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a failure shows at the end of a log, so a cap has to trim the start and never the whole file.
func keepTail(path string, limit int64) {
	info, err := os.Stat(path)
	if err != nil || info.Size() <= limit {
		return
	}
	source, err := os.Open(path)
	if err != nil {
		return
	}
	defer source.Close()
	if _, err := source.Seek(info.Size()-limit, io.SeekStart); err != nil {
		return
	}
	trimmed := path + ".trim"
	destination, err := os.Create(trimmed)
	if err != nil {
		return
	}
	_, copyErr := io.Copy(destination, source)
	closeErr := destination.Close()
	if copyErr != nil || closeErr != nil || os.Rename(trimmed, path) != nil {
		_ = os.Remove(trimmed)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an install whose gateway intercepts nothing mounts no CA, and every host then serves a certificate the public roots already cover — so a missing share is silence rather than a warning.
func bindCA() {
	if _, err := os.Stat(vmrunner.ShareCADir); err != nil {
		return
	}
	if err := os.MkdirAll(vmrunner.GuestCADir, 0o755); err != nil {
		logf("WARNING: creating %s (%v); intercepted hosts may fail TLS", vmrunner.GuestCADir, err)
		return
	}
	if err := bindReadOnly(vmrunner.ShareCADir, vmrunner.GuestCADir); err != nil {
		logf("WARNING: binding the CA to %s (%v); intercepted hosts may fail TLS", vmrunner.GuestCADir, err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the image's own boot may keep its extracted CA trust store here rather than rebuilding it every time. The variable is set only on this backend, so an image that honors it caches on a machine and silently does without in a container, where there is no disk to cache on.
func offerTrustCache(root string) {
	trust := vmrunner.SystemStore(root, "trust")
	if err := os.MkdirAll(trust, 0o755); err != nil {
		logf("WARNING: no trust cache directory (%v); the image re-extracts its CA store every boot", err)
		return
	}
	if err := os.Setenv(trustCacheEnv, trust); err != nil {
		logf("WARNING: could not set %s (%v)", trustCacheEnv, err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the first boot seeds a declared path from whatever the image ships there, so a home an image baked is the home the agent starts from. The copy lands beside its destination and is renamed into place, so a boot interrupted halfway leaves no half-seeded store to be mistaken for a complete one: the next boot finds nothing and seeds again.
func persist(root, path string) {
	store := vmrunner.AgentStore(root, path)
	_, err := os.Stat(store)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		if err := seed(path, store); err != nil {
			fatal("seeding %s onto the disk: %v", path, err)
		}
	case err != nil:
		fatal("reading %s on the disk: %v", store, err)
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		fatal("creating the guest mountpoint %s: %v", path, err)
	}
	if err := syscall.Mount(store, path, "", syscall.MS_BIND, ""); err != nil {
		fatal("mounting %s from the disk: %v", path, err)
	}
	logf("persisting %s", path)
}

func seed(from, store string) error {
	if err := os.MkdirAll(filepath.Dir(store), 0o755); err != nil {
		return err
	}
	staged := store + ".seeding"
	if err := os.RemoveAll(staged); err != nil {
		return err
	}
	source, err := os.Lstat(from)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		if err := os.MkdirAll(staged, 0o755); err != nil {
			return err
		}
	case err != nil:
		return err
	default:
		if err := copyTree(from, staged, source); err != nil {
			_ = os.RemoveAll(staged)
			return err
		}
	}
	return os.Rename(staged, store)
}

// UNIT_BOUNDARY_DESCRIPTION: ownership and mode are copied, not just content. An image's home belongs to the user its harness runs as, and a tree reproduced as root's would leave that user unable to write its own home. Mode is set after the entry exists rather than at creation, because creation masks it through the umask this process inherited — which would quietly drop the group-write, setgid and sticky bits an image relies on, once, on the only boot that seeds. Sockets, devices and fifos are skipped: they are not state an agent carries across a boot, and reproducing them needs privileges this copy should not assume.
func copyTree(from, to string, info fs.FileInfo) error {
	switch {
	case info.Mode()&fs.ModeSymlink != 0:
		target, err := os.Readlink(from)
		if err != nil {
			return err
		}
		if err := os.Symlink(target, to); err != nil {
			return err
		}
	case info.IsDir():
		if err := os.Mkdir(to, info.Mode().Perm()); err != nil && !errors.Is(err, fs.ErrExist) {
			return err
		}
		entries, err := os.ReadDir(from)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			child, err := entry.Info()
			if err != nil {
				return err
			}
			if err := copyTree(filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name()), child); err != nil {
				return err
			}
		}
	case info.Mode().IsRegular():
		if err := copyFile(from, to, info.Mode().Perm()); err != nil {
			return err
		}
	default:
		logf("WARNING: not seeding %s, which is neither a file, a directory nor a symlink", from)
		return nil
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		if err := os.Lchown(to, int(stat.Uid), int(stat.Gid)); err != nil {
			return err
		}
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return nil
	}
	return os.Chmod(to, info.Mode().Perm()|info.Mode()&(fs.ModeSetuid|fs.ModeSetgid|fs.ModeSticky))
}

func copyFile(from, to string, mode fs.FileMode) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(destination, source); err != nil {
		destination.Close()
		return err
	}
	return destination.Close()
}

// UNIT_BOUNDARY_DESCRIPTION: read-only is a property of the mount and not of the bind, so it takes a second call. A bind that cannot be made read-only is still a working bind, and what it exposes is a share the guest cannot write to anyway.
func bindReadOnly(from, to string) error {
	if err := syscall.Mount(from, to, "", syscall.MS_BIND, ""); err != nil {
		return err
	}
	if err := syscall.Mount("", to, "", syscall.MS_BIND|syscall.MS_REMOUNT|syscall.MS_RDONLY, ""); err != nil {
		logf("WARNING: %s stays writable in this guest (%v)", to, err)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: an image's launch record may name a bare command, which a container runtime would resolve against PATH — so this resolves it the same way rather than failing on an entrypoint that works everywhere else.
func lookPath(command string) (string, error) {
	if filepath.Base(command) != command {
		return command, executable(command)
	}
	search := os.Getenv("PATH")
	if search == "" {
		search = defaultPath
	}
	for _, dir := range filepath.SplitList(search) {
		candidate := filepath.Join(dir, command)
		if executable(candidate) == nil {
			return candidate, nil
		}
	}
	return "", fs.ErrNotExist
}

func executable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() || info.Mode().Perm()&0o111 == 0 {
		return fs.ErrPermission
	}
	return nil
}
