package vmrunner

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	slowStatus = time.Second
	// UNIT_BOUNDARY_DESCRIPTION: a create is tens of milliseconds and a start is under a second, so this is far enough above both that a normal operation never trips it and an operator reading the log finds only the ones worth reading.
	slowOp = 2 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: long enough for a guest to checkpoint its journal and let go of its disks, short enough that a VMM which is never going to exit is taken down rather than waited on.
	vmmExitWait = 10 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: expanding both templates takes seconds on a healthy pod; this is far enough above that to never cut one short, and it exists so a decompressor that hangs cannot hold the goroutine for the life of the runner.
	warmTimeout = 5 * time.Minute
)

var errImageLaunchUnknown = errors.New("this image names no entrypoint, so a machine would boot to a filesystem with nothing running in it")

type Smolvm struct {
	Bin string
	// UNIT_BOUNDARY_DESCRIPTION: the runner's lifetime, which every smolvm invocation is a child of. Nil means none, and each call is then bounded only by its own timeout — which is what a Preloader gets, having no runner to belong to. The Server sets it so that closing the runner ends the calls it has out, rather than leaving them to a timeout measured in minutes.
	Lifetime context.Context
	// UNIT_BOUNDARY_DESCRIPTION: where expanded disk templates are kept across pod rolls, one directory per compressed template's sha256. Empty keeps them beside the binary, in the container filesystem, which a roll throws away. Keying by content is what makes a new smolvm release safe here: its templates land in a new directory, so a disk that smolvm backed onto an older template never sees its bytes change.
	TemplateDir string

	// UNIT_BOUNDARY_DESCRIPTION: machine id to smolvm's vm directory. Finding one means reading the name file of every machine, and Start and Stop each need one; the entry is checked against its name file on every use and rescanned when that check fails, so a stale entry costs one rescan and never returns the wrong directory.
	dirsMu sync.Mutex
	dirs   map[string]string
}

func (r *Smolvm) lifetime() context.Context {
	if r.Lifetime == nil {
		return context.Background()
	}
	return r.Lifetime
}

func (r *Smolvm) State(id string) (string, error) {
	ctx, cancel := context.WithTimeout(r.lifetime(), 30*time.Second)
	defer cancel()
	started := time.Now()
	out, err := exec.CommandContext(ctx, r.Bin, "machine", "status", "-n", id, "--json").Output()
	if elapsed := time.Since(started); elapsed > slowStatus {
		slog.Warn("machine status is slow to answer", "machine", id, "duration_ms", elapsed.Milliseconds())
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && bytes.Contains(exit.Stderr, []byte("not found")) {
			return StateAbsent, nil
		}
		return StateUnknown, fmt.Errorf("smolvm machine status %s: %w", id, err)
	}
	var st struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(out, &st); err != nil {
		return StateUnknown, fmt.Errorf("smolvm machine status %s: %w", id, err)
	}
	if st.State != "running" {
		return StateStopped, nil
	}
	return StateRunning, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an image booted from a tree of its own files names nothing to run, so everything the image would have said — its entrypoint, its environment, the directory it starts in — is said here instead. The two environments are merged before either reaches the command line rather than passed one after the other, so which one wins is decided here and not by whichever order smolvm happens to apply them in; the platform's own values win, because they are what make the guest an agent rather than the image's idea of a container.
func (r *Smolvm) Create(id string, spec MachineSpec, image string, hostPort int, share string, launch *ImageLaunch) error {
	args := []string{"machine", "create", "-n", id, "-I", image, "--max-image-size", "16GiB",
		"--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB), "--storage", strconv.Itoa(spec.StorageGiB),
		"-u", "root", "--net", "--net-backend", "virtio-net", "-p", fmt.Sprintf("%d:%d", hostPort, guestAgentPort),
		"-v", share + ":" + SharePath + ":ro"}
	for _, c := range spec.AllowCIDRs {
		args = append(args, "--allow-cidr", c)
	}
	env := spec.Env
	var command []string
	if launch != nil {
		env = map[string]string{}
		for _, kv := range launch.Env {
			if k, v, ok := strings.Cut(kv, "="); ok {
				env[k] = v
			}
		}
		for k, v := range spec.Env {
			env[k] = v
		}
		if launch.WorkingDir != "" {
			args = append(args, "-w", launch.WorkingDir)
		}
		command = append(append([]string{}, launch.Entrypoint...), launch.Cmd...)
	}
	if len(command) == 0 {
		return errImageLaunchUnknown
	}
	args = append(args, envArgs(env)...)
	args = append(append(args, "--", InitPath), command...)
	r.forgetVMDir(id)
	return r.run(envValues(spec.Env), args...)
}

func (r *Smolvm) Update(id string, spec MachineSpec, applied *MachineSpec) error {
	args := []string{"machine", "update", "-n", id, "--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB)}
	if applied != nil && applied.StorageGiB < spec.StorageGiB {
		args = append(args, "--storage", strconv.Itoa(spec.StorageGiB))
	}
	if applied != nil {
		for k := range applied.Env {
			if _, kept := spec.Env[k]; !kept {
				args = append(args, "--remove-env", k)
			}
		}
	}
	return r.run(envValues(spec.Env), append(args, envArgs(spec.Env)...)...)
}

func (r *Smolvm) Stop(id string) error {
	if err := r.run(nil, "machine", "stop", "-n", id); err != nil {
		return err
	}
	discardOverlay(id, r.vmDir(id))
	return nil
}

func (r *Smolvm) Delete(id string) error {
	defer r.forgetVMDir(id)
	return r.run(nil, "machine", "delete", "-n", id, "-f")
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's root is a throwaway overlay, and this is what makes that true rather than nearly true. Kept, it is a tier nobody declared: it survives an ordinary stop and start, so software installed outside the declared paths looks persistent, and is then thrown away by the first boot that has to discard a corrupt one — weeks later, silently, with no way to tell afterwards which of the two a machine did. Discarded every time, the rule is the same sentence as the container backend's: a declared path, or gone. It runs on the way down, so a hibernated fleet does not hold an overlay each on its owner's disk, and again on the way up, because a machine that died with its runner never got the stop and would otherwise wake onto a stale root.
func discardOverlay(id, dir string) {
	if dir == "" {
		return
	}
	if !vmmGone("/proc", dir, vmmExitWait) {
		slog.Warn("machine still has a VMM holding its disks; leaving the root overlay in place", "machine", id)
		return
	}
	for _, f := range []string{"overlay.qcow2", "overlay.raw", "overlay.formatted"} {
		if err := os.Remove(filepath.Join(dir, f)); err != nil && !os.IsNotExist(err) {
			slog.Warn("could not discard the root overlay", "machine", id, "file", f, "error", err)
		}
	}
}

func (r *Smolvm) Start(id string) error {
	dir := r.vmDir(id)
	if dir != "" {
		_ = r.runReporting(false, nil, "machine", "stop", "-n", id)
		if !vmmGone("/proc", dir, vmmExitWait) {
			for _, pid := range orphanPIDs("/proc", dir) {
				_ = syscall.Kill(pid, syscall.SIGKILL)
			}
			_ = vmmGone("/proc", dir, time.Second)
		}
		for _, f := range []string{"agent.ready", "agent.sock", "control.sock", "vm.lock", "agent.pid"} {
			_ = os.Remove(filepath.Join(dir, f))
		}
		discardOverlay(id, dir)
	}
	err := r.run(nil, "machine", "start", "-n", id)
	if err != nil {
		for _, pid := range orphanPIDs("/proc", dir) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: stopping returns as soon as the guest has been asked to go, but the VMM outlives that request for as long as the shutdown takes — seconds, while the guest remounts its disk read-only and checkpoints its journal. A start issued inside that window is refused on the grounds that a VMM still holds the disks, and the refusal is indistinguishable from a machine that can never start: the next attempt stops whatever the last one left running and is refused the same way, so an agent nobody can wake stays unwakeable. A machine that really is stopped has nothing to wait for and answers at once, so an ordinary wake pays nothing for this.
func vmmGone(procRoot, dir string, limit time.Duration) bool {
	deadline := time.Now().Add(limit)
	for len(orphanPIDs(procRoot, dir)) > 0 {
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
	return true
}

func (r *Smolvm) vmDir(id string) string {
	r.dirsMu.Lock()
	defer r.dirsMu.Unlock()
	if dir, ok := r.dirs[id]; ok && namesMachine(dir, id) {
		return dir
	}
	r.dirs = scanVMDirs()
	return r.dirs[id]
}

func (r *Smolvm) forgetVMDir(id string) {
	r.dirsMu.Lock()
	delete(r.dirs, id)
	r.dirsMu.Unlock()
}

func scanVMDirs() map[string]string {
	names, _ := filepath.Glob(filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "*", "name"))
	dirs := make(map[string]string, len(names))
	for _, f := range names {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		if id := strings.TrimSpace(string(b)); dirs[id] == "" {
			dirs[id] = filepath.Dir(f)
		}
	}
	return dirs
}

func namesMachine(dir, id string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "name"))
	return err == nil && strings.TrimSpace(string(b)) == id
}

func orphanPIDs(procRoot, vmDir string) []int {
	if vmDir == "" {
		return nil
	}
	entries, _ := os.ReadDir(procRoot)
	var pids []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		if cmd, _ := os.ReadFile(filepath.Join(procRoot, e.Name(), "cmdline")); bytes.Contains(cmd, []byte(vmDir+"/")) {
			pids = append(pids, pid)
		}
	}
	return pids
}

func envArgs(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var args []string
	for _, k := range keys {
		args = append(args, "-e", k+"="+env[k])
	}
	return args
}

// UNIT_BOUNDARY_DESCRIPTION: an operator's Secret reaches a guest on this command line, and a failure carries the command's own output into the Agent's status and the platform's logs — so a tool that echoes its invocation would publish those values, in whatever shape it happens to print them.
func (r *Smolvm) run(secrets []string, args ...string) error {
	return r.runReporting(true, secrets, args...)
}

func (r *Smolvm) runReporting(report bool, secrets []string, args ...string) error {
	ctx, cancel := context.WithTimeout(r.lifetime(), opTimeout)
	defer cancel()
	started := time.Now()
	out, err := exec.CommandContext(ctx, r.Bin, args...).CombinedOutput()
	op := strings.Join(args[:2], " ")
	if err != nil {
		if report {
			slog.Warn("machine operation failed", "op", op, "duration_ms", time.Since(started).Milliseconds())
		}
		return fmt.Errorf("smolvm %s: %w: %s", op, err, redact(strings.TrimSpace(string(out)), secrets))
	}
	elapsed := time.Since(started)
	slog.Info("machine operation", "op", op, "duration_ms", elapsed.Milliseconds())
	// UNIT_BOUNDARY_DESCRIPTION: a create that usually takes half a second sometimes takes twenty, and only when the platform is the one asking — by hand it never reproduces, so the evidence has to be collected at the moment it happens rather than afterwards. smolvm accounts for its own boot in phases (disks ready, config written, subprocess spawned, each with the milliseconds it took), so the runtime's account of a slow operation is kept where an operator will find it, and only then: the same text on every operation would bury the one that matters. It carries the command's output, so it is redacted like a failure's — an operator's Secret reaches a guest on that command line.
	if elapsed > slowOp {
		slog.Warn("machine operation was slow, with the runtime's own account of it",
			"op", op, "duration_ms", elapsed.Milliseconds(),
			"detail", firstLines(redact(string(out), secrets)))
	}
	return nil
}

func redact(out string, secrets []string) string {
	var pairs []string
	for _, v := range secrets {
		if len(v) > 3 {
			pairs = append(pairs, v, "***")
		}
	}
	if pairs == nil {
		return out
	}
	return strings.NewReplacer(pairs...).Replace(out)
}

func envValues(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for _, v := range env {
		out = append(out, v)
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: the runtime ships its disk templates compressed and expands them the first time a machine needs one, into the directory it lives in — which in a container is the image's own filesystem and so is thrown away with the pod. Left alone, every roll of this pod hands the expansion to whoever creates the next agent: measured at 24 s of a 25 s `machine start`, while a second create on the same pod costs half a second. This finds the templates a fresh pod still has to put in place; WarmTemplates puts them there, from the runner's claim when an earlier pod already expanded them. It reports which templates are missing rather than expanding them, so the decision can be tested without a compressor.
func templatesToWarm(dir string) []string {
	packed, _ := filepath.Glob(filepath.Join(dir, "*.ext4.zst"))
	var missing []string
	for _, p := range packed {
		if _, err := os.Stat(strings.TrimSuffix(p, ".zst")); err != nil {
			missing = append(missing, p)
		}
	}
	return missing
}

// UNIT_BOUNDARY_DESCRIPTION: `--sparse` is not the default when the decompressor writes to a named file, and without it a 20 GiB template of mostly holes is written out in full: measured on the runner image at 20 GiB on disk and 33 s, against 672 KiB and 4 s with it, for byte-identical output. The templates are holes almost end to end, so this is the difference between warming them and filling the pod's filesystem. A failure here is logged and left alone — the runtime still expands what it needs, which is exactly the behaviour this exists to pre-empt.
func (r *Smolvm) WarmTemplates() {
	dir := filepath.Dir(r.Bin)
	packedAll := templatesToWarm(dir)
	if len(packedAll) == 0 {
		// UNIT_BOUNDARY_DESCRIPTION: silence here would read the same whether the templates are already expanded or the directory holds none at all, and the second is a misconfiguration that only shows up later as a slow create.
		slog.Info("no disk templates to warm", "dir", dir)
		return
	}
	ctx, cancel := context.WithTimeout(r.lifetime(), warmTimeout)
	defer cancel()
	for _, packed := range packedAll {
		target := strings.TrimSuffix(packed, ".zst")
		if r.TemplateDir == "" {
			if err := expandTemplate(ctx, packed, target); err != nil {
				slog.Warn("template warm-up failed; the first machine will expand it instead", "template", packed, "error", err)
			}
			continue
		}
		if err := r.linkKeptTemplate(ctx, packed, target); err != nil {
			slog.Warn("template warm-up failed; the first machine will expand it instead", "template", packed, "error", err)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm looks for a plain template beside its binary before it looks for the compressed one, and follows a symlink there. So the template is expanded once onto the runner's claim and the binary's directory gets a link to it: a pod roll then costs a hash of the compressed file and a symlink, not the 24 s expansion. smolvm resolves the link before it writes a template's path into a qcow2 disk, so new disks name the content-keyed file and not the link. The link is made under a temporary name and renamed over the target, so a machine created meanwhile sees either no template or a whole one.
func (r *Smolvm) linkKeptTemplate(ctx context.Context, packed, target string) error {
	key, err := fileSHA256(packed)
	if err != nil {
		return err
	}
	kept := filepath.Join(r.TemplateDir, key, filepath.Base(target))
	started := time.Now()
	if _, err := os.Stat(kept); err != nil {
		if err := os.MkdirAll(filepath.Dir(kept), 0o755); err != nil {
			return err
		}
		if err := expandTemplate(ctx, packed, kept); err != nil {
			return err
		}
	}
	link := target + ".linking"
	_ = os.Remove(link)
	if err := os.Symlink(kept, link); err != nil {
		return err
	}
	if err := os.Rename(link, target); err != nil {
		_ = os.Remove(link)
		return err
	}
	slog.Info("template warmed", "template", target, "kept", kept, "duration_ms", time.Since(started).Milliseconds())
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: expansion goes to a temporary name and is renamed over the target, so a machine created while this runs never opens a half-written template; the runtime writing its own copy in the meantime is harmless, both being the same bytes from the same source.
func expandTemplate(ctx context.Context, packed, target string) error {
	tmp := target + ".warming"
	started := time.Now()
	if out, err := exec.CommandContext(ctx, "zstd", "-d", "-q", "-f", "--sparse", "-o", tmp, packed).CombinedOutput(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("%w: %s", err, firstLines(string(out)))
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	slog.Info("template expanded", "template", target, "duration_ms", time.Since(started).Milliseconds())
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
