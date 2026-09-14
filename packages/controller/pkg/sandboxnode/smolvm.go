package sandboxnode

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

type Smolvm struct {
	Bin string
}

func (r *Smolvm) State(id string) string {
	out, err := exec.Command(r.Bin, "machine", "status", "-n", id, "--json").Output()
	if err != nil {
		return StateAbsent
	}
	var st struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(out, &st); err != nil || st.State != "running" {
		return StateStopped
	}
	return StateRunning
}

func (r *Smolvm) Create(id string, spec MachineSpec, image string, hostPort int, caDir string) error {
	args := []string{"machine", "create", "-n", id, "-I", image, "--max-image-size", "16GiB",
		"--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB), "--storage", strconv.Itoa(spec.StorageGiB),
		"-u", "root", "--net", "--net-backend", "virtio-net", "-p", fmt.Sprintf("%d:%d", hostPort, guestAgentPort),
		"-v", caDir + ":/etc/platform/ca:ro"}
	for _, c := range spec.AllowCIDRs {
		args = append(args, "--allow-cidr", c)
	}
	return r.run(append(args, envArgs(spec.Env)...)...)
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
	return r.run(append(args, envArgs(spec.Env)...)...)
}

func (r *Smolvm) Stop(id string) error   { return r.run("machine", "stop", "-n", id) }
func (r *Smolvm) Delete(id string) error { return r.run("machine", "delete", "-n", id, "-f") }

func (r *Smolvm) Start(id string) error {
	if dir := r.vmDir(id); dir != "" {
		_ = r.run("machine", "stop", "-n", id)
		for _, f := range []string{"agent.ready", "agent.sock", "control.sock", "vm.lock", "agent.pid", "overlay.qcow2", "overlay.formatted"} {
			_ = os.Remove(filepath.Join(dir, f))
		}
	}
	err := r.run("machine", "start", "-n", id)
	if err != nil {
		for _, pid := range orphanPIDs("/proc", r.vmDir(id)) {
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

func (r *Smolvm) run(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, r.Bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("smolvm %s: %w: %s", strings.Join(args[:2], " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}
