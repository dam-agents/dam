package vmrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const slowStatus = time.Second

type Smolvm struct {
	Bin string
}

func (r *Smolvm) State(id string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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

func (r *Smolvm) Create(id string, spec MachineSpec, image string, hostPort int, caDir string) error {
	args := []string{"machine", "create", "-n", id, "-I", image, "--max-image-size", "16GiB",
		"--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB), "--storage", strconv.Itoa(spec.StorageGiB),
		"-u", "root", "--net", "--net-backend", "virtio-net", "-p", fmt.Sprintf("%d:%d", hostPort, guestAgentPort),
		"-v", caDir + ":/etc/platform/ca:ro"}
	for _, c := range spec.AllowCIDRs {
		args = append(args, "--allow-cidr", c)
	}
	return r.run(envValues(spec.Env), append(args, envArgs(spec.Env)...)...)
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

func (r *Smolvm) Stop(id string) error   { return r.run(nil, "machine", "stop", "-n", id) }
func (r *Smolvm) Delete(id string) error { return r.run(nil, "machine", "delete", "-n", id, "-f") }

func (r *Smolvm) Start(id string) error {
	dir := r.vmDir(id)
	if dir != "" {
		_ = r.run(nil, "machine", "stop", "-n", id)
		for _, f := range []string{"agent.ready", "agent.sock", "control.sock", "vm.lock", "agent.pid"} {
			_ = os.Remove(filepath.Join(dir, f))
		}
	}
	err := r.run(nil, "machine", "start", "-n", id)
	if err != nil && dir != "" && strings.Contains(err.Error(), "boot process exited") {
		for _, f := range []string{"overlay.qcow2", "overlay.formatted"} {
			_ = os.Remove(filepath.Join(dir, f))
		}
		err = r.run(nil, "machine", "start", "-n", id)
	}
	if err != nil {
		for _, pid := range orphanPIDs("/proc", dir) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
	return err
}

func (r *Smolvm) vmDir(id string) string {
	names, _ := filepath.Glob(filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "*", "name"))
	for _, f := range names {
		if b, err := os.ReadFile(f); err == nil && strings.TrimSpace(string(b)) == id {
			return filepath.Dir(f)
		}
	}
	return ""
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
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	started := time.Now()
	out, err := exec.CommandContext(ctx, r.Bin, args...).CombinedOutput()
	op := strings.Join(args[:2], " ")
	if err != nil {
		slog.Warn("machine operation failed", "op", op, "duration_ms", time.Since(started).Milliseconds())
		return fmt.Errorf("smolvm %s: %w: %s", op, err, redact(strings.TrimSpace(string(out)), secrets))
	}
	slog.Info("machine operation", "op", op, "duration_ms", time.Since(started).Milliseconds())
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
