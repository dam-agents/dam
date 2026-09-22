package vmconformance

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/dam-agents/dam/packages/controller/pkg/vmprobe"
)

// UNIT_BOUNDARY_DESCRIPTION: which part this test binary plays when it is not running tests. The runner under test forks smolvm for every machine operation, so the binary stands in for smolvm itself, and for the guest a started machine runs.
const fakeRole = "VMRUNNER_CONFORMANCE_FAKE"

const (
	roleSmolvm = "smolvm"
	roleGuest  = "guest"
	envVMMDir  = "VMRUNNER_CONFORMANCE_VMM_DIR"
	envGuestAt = "VMRUNNER_CONFORMANCE_GUEST_ADDR"
)

// UNIT_BOUNDARY_DESCRIPTION: what the fake VMM keeps per machine, the way smolvm keeps it beside the machine's disk: the guest's host port, its environment, and the process running it. The disk is a directory beside it that outlives a stop and goes with a delete, which is exactly the persistence the suite checks.
type fakeMachine struct {
	HostPort int               `json:"hostPort"`
	Env      map[string]string `json:"env"`
	PID      int               `json:"pid"`
	Running  bool              `json:"running"`
}

type fakeVMM struct{ dir string }

func (v fakeVMM) machineDir(id string) string { return filepath.Join(v.dir, id) }

func (v fakeVMM) load(id string) (*fakeMachine, error) {
	b, err := os.ReadFile(filepath.Join(v.machineDir(id), "machine.json"))
	if err != nil {
		return nil, err
	}
	var m fakeMachine
	return &m, json.Unmarshal(b, &m)
}

func (v fakeVMM) save(id string, m *fakeMachine) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(v.machineDir(id), "machine.json"), b, 0o644)
}

type smolvmArgs struct {
	verb, id  string
	hostPort  int
	env       map[string]string
	removeEnv []string
}

func parseSmolvm(args []string) (smolvmArgs, error) {
	if len(args) < 2 || args[0] != "machine" {
		return smolvmArgs{}, fmt.Errorf("unexpected smolvm call %q", args)
	}
	parsed := smolvmArgs{verb: args[1], env: map[string]string{}}
	for i := 2; i < len(args); i++ {
		if args[i] == "--" {
			break
		}
		if i+1 >= len(args) {
			continue
		}
		switch args[i] {
		case "-n":
			parsed.id = args[i+1]
		case "-p":
			host, _, _ := strings.Cut(args[i+1], ":")
			parsed.hostPort, _ = strconv.Atoi(host)
		case "-e":
			k, val, _ := strings.Cut(args[i+1], "=")
			parsed.env[k] = val
		case "--remove-env":
			parsed.removeEnv = append(parsed.removeEnv, args[i+1])
		default:
			continue
		}
		i++
	}
	return parsed, nil
}

func fakeSmolvm(args []string) int {
	parsed, err := parseSmolvm(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	v := fakeVMM{dir: os.Getenv(envVMMDir)}
	if err := v.run(parsed); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func (v fakeVMM) run(a smolvmArgs) error {
	if a.verb == "create" {
		if err := os.MkdirAll(filepath.Join(v.machineDir(a.id), "disk"), 0o755); err != nil {
			return err
		}
		return v.save(a.id, &fakeMachine{HostPort: a.hostPort, Env: a.env})
	}
	m, err := v.load(a.id)
	if err != nil {
		if a.verb == "delete" && os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("machine '%s' not found", a.id)
	}
	switch a.verb {
	case "status":
		state := "stopped"
		if m.Running {
			state = "running"
		}
		fmt.Printf("{\"state\":%q}\n", state)
		return nil
	case "update":
		for _, k := range a.removeEnv {
			delete(m.Env, k)
		}
		for k, val := range a.env {
			m.Env[k] = val
		}
		return v.save(a.id, m)
	case "start":
		v.halt(m)
		if err := v.boot(a.id, m); err != nil {
			return err
		}
		return v.save(a.id, m)
	case "stop":
		v.halt(m)
		return v.save(a.id, m)
	case "delete":
		v.halt(m)
		return os.RemoveAll(v.machineDir(a.id))
	}
	return fmt.Errorf("unexpected smolvm verb %q", a.verb)
}

func (v fakeVMM) boot(id string, m *fakeMachine) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	logFile, err := os.Create(filepath.Join(v.machineDir(id), "guest.log"))
	if err != nil {
		return err
	}
	defer logFile.Close()
	guest := exec.Command(self)
	guest.Env = append(os.Environ(), fakeRole+"="+roleGuest,
		envGuestAt+"="+fmt.Sprintf("127.0.0.1:%d", m.HostPort),
		vmprobe.EnvDir+"="+filepath.Join(v.machineDir(id), "disk"))
	for k, val := range m.Env {
		guest.Env = append(guest.Env, k+"="+val)
	}
	guest.Stdout, guest.Stderr = logFile, logFile
	guest.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := guest.Start(); err != nil {
		return err
	}
	m.PID, m.Running = guest.Process.Pid, true
	return guest.Process.Release()
}

// UNIT_BOUNDARY_DESCRIPTION: the guest is not this process's child once the smolvm call that started it has exited, so its exit cannot be waited for — its port is. A killed process closes its listener as it dies, even while it is left a zombie nobody reaps, and a closed port is also the one thing the runner's health check reads.
func (v fakeVMM) halt(m *fakeMachine) {
	if m.PID != 0 {
		_ = syscall.Kill(m.PID, syscall.SIGKILL)
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", m.HostPort), 100*time.Millisecond)
			if err != nil {
				break
			}
			conn.Close()
			time.Sleep(20 * time.Millisecond)
		}
	}
	m.PID, m.Running = 0, false
}

func fakeGuest() int {
	if err := vmprobe.Serve(os.Getenv(envGuestAt), vmprobe.FromEnv(os.Getenv)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

// UNIT_BOUNDARY_DESCRIPTION: guests outlive the smolvm call that started them, and the runner never stops its machines when it closes, so whatever a test left running is killed here rather than left on the host after the test binary exits.
func (v fakeVMM) haltAll() {
	entries, _ := os.ReadDir(v.dir)
	for _, e := range entries {
		if m, err := v.load(e.Name()); err == nil {
			v.halt(m)
		}
	}
}
