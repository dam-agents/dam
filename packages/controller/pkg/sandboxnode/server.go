package sandboxnode

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	guestAgentPort = 8080
	loopbackOffset = 1000
)

var machineID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type Server struct {
	Token    string
	StateDir string
	Smolvm   string
	PortMin  int
	PortMax  int

	mu        sync.Mutex
	pending   map[string]string
	lastErr   map[string]string
	listeners map[string]net.Listener
}

func (s *Server) Start() error {
	entries, err := os.ReadDir(s.StateDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if p := s.port(e.Name()); p != 0 {
			if err := s.forward(e.Name(), p); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, ln := range s.listeners {
		ln.Close()
		delete(s.listeners, id)
	}
}

func (s *Server) forward(id string, port int) error {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("publishing machine %s on :%d: %w", id, port, err)
	}
	s.mu.Lock()
	if s.listeners == nil {
		s.listeners = map[string]net.Listener{}
	}
	s.listeners[id] = ln
	s.mu.Unlock()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				guest, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port+loopbackOffset), 3*time.Second)
				if err != nil {
					return
				}
				defer guest.Close()
				go func() { _, _ = io.Copy(guest, conn) }()
				_, _ = io.Copy(conn, guest)
			}()
		}
	}()
	return nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("PUT /machines/{id}", s.guard(s.put))
	mux.HandleFunc("GET /machines/{id}", s.guard(s.get))
	mux.HandleFunc("DELETE /machines/{id}", s.guard(s.delete))
	return mux
}

func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !machineID.MatchString(r.PathValue("id")) {
			http.Error(w, "invalid machine id", http.StatusBadRequest)
			return
		}
		next(w, r)
	}
}

func (s *Server) put(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var spec MachineSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if spec.Running && (spec.Image == "" || spec.CPUs < 1 || spec.MemoryMiB < 1 || spec.StorageGiB < 1) {
		http.Error(w, "image, cpus, memoryMiB and storageGiB are required", http.StatusBadRequest)
		return
	}
	st := s.status(id)
	switch {
	case st.State == StateCreating, st.State == StateStarting, st.State == StateStopping:
	case spec.Running && st.State == StateAbsent:
		s.spawn(id, StateCreating, func() error { return s.create(id, spec) })
		st.State = StateCreating
	case spec.Running && st.State == StateStopped:
		s.spawn(id, StateStarting, func() error { return s.start(id, spec) })
		st.State = StateStarting
	case !spec.Running && st.State == StateRunning:
		s.spawn(id, StateStopping, func() error { return s.smolvm("machine", "stop", "-n", id) })
		st.State = StateStopping
	}
	st.Message = s.errorOf(id)
	writeJSON(w, st)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st := s.status(id)
	st.Message = s.errorOf(id)
	writeJSON(w, st)
}

func (s *Server) delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if st := s.status(id); st.State != StateAbsent {
		if err := s.smolvm("machine", "delete", "-n", id, "-f"); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := os.RemoveAll(s.machineDir(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	delete(s.lastErr, id)
	if ln := s.listeners[id]; ln != nil {
		ln.Close()
		delete(s.listeners, id)
	}
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) spawn(id, state string, op func() error) {
	s.mu.Lock()
	if s.pending == nil {
		s.pending = map[string]string{}
		s.lastErr = map[string]string{}
	}
	s.pending[id] = state
	s.mu.Unlock()
	go func() {
		err := op()
		s.mu.Lock()
		delete(s.pending, id)
		if err != nil {
			s.lastErr[id] = err.Error()
			slog.Error("machine operation failed", "machine", id, "op", state, "error", err)
		} else {
			delete(s.lastErr, id)
		}
		s.mu.Unlock()
	}()
}

func (s *Server) errorOf(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastErr[id]
}

func (s *Server) status(id string) MachineStatus {
	s.mu.Lock()
	pending := s.pending[id]
	s.mu.Unlock()
	port := s.port(id)
	if pending != "" {
		return MachineStatus{State: pending, Port: port}
	}
	out, err := exec.Command(s.Smolvm, "machine", "status", "-n", id, "--json").Output()
	if err != nil {
		return MachineStatus{State: StateAbsent}
	}
	var st struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(out, &st); err != nil || st.State != "running" {
		return MachineStatus{State: StateStopped, Port: port}
	}
	return MachineStatus{State: StateRunning, Port: port, Ready: s.healthy(port)}
}

func (s *Server) healthy(port int) bool {
	if port == 0 {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", port+loopbackOffset))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (s *Server) create(id string, spec MachineSpec) error {
	dir := s.machineDir(id)
	if err := s.writeCA(id, spec.CACert); err != nil {
		return err
	}
	port, err := s.allocatePort(id)
	if err != nil {
		return err
	}
	image := spec.Image
	if archive := filepath.Join(s.StateDir, "images", strings.NewReplacer("/", "_", ":", "_").Replace(image)+".tar"); fileExists(archive) {
		image = archive
	}
	args := []string{"machine", "create", "-n", id, "-I", image, "--max-image-size", "16GiB",
		"--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB), "--storage", strconv.Itoa(spec.StorageGiB),
		"-u", "root", "--net", "-p", fmt.Sprintf("%d:%d", port+loopbackOffset, guestAgentPort),
		"-v", filepath.Join(dir, "ca") + ":/etc/platform/ca:ro"}
	for _, c := range spec.AllowCIDRs {
		args = append(args, "--allow-cidr", c)
	}
	args = append(args, envArgs(spec.Env)...)
	if err := s.smolvm(args...); err != nil {
		return err
	}
	if err := s.forward(id, port); err != nil {
		return err
	}
	return s.smolvm("machine", "start", "-n", id)
}

func (s *Server) start(id string, spec MachineSpec) error {
	if err := s.writeCA(id, spec.CACert); err != nil {
		return err
	}
	args := append([]string{"machine", "update", "-n", id, "--cpus", strconv.Itoa(spec.CPUs), "--mem", strconv.Itoa(spec.MemoryMiB)}, envArgs(spec.Env)...)
	if err := s.smolvm(args...); err != nil {
		return err
	}
	return s.smolvm("machine", "start", "-n", id)
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

func (s *Server) writeCA(id, ca string) error {
	caDir := filepath.Join(s.machineDir(id), "ca")
	if err := os.MkdirAll(caDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(caDir, "ca.crt"), []byte(ca), 0o644)
}

func (s *Server) allocatePort(id string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p := s.port(id); p != 0 {
		return p, nil
	}
	used := map[int]bool{}
	entries, _ := os.ReadDir(s.StateDir)
	for _, e := range entries {
		used[s.port(e.Name())] = true
	}
	for p := s.PortMin; p <= s.PortMax; p++ {
		if !used[p] {
			return p, os.WriteFile(filepath.Join(s.machineDir(id), "port"), []byte(strconv.Itoa(p)), 0o644)
		}
	}
	return 0, errors.New("no free machine port")
}

func (s *Server) port(id string) int {
	b, err := os.ReadFile(filepath.Join(s.machineDir(id), "port"))
	if err != nil {
		return 0
	}
	p, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return p
}

func (s *Server) machineDir(id string) string { return filepath.Join(s.StateDir, id) }

func (s *Server) smolvm(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, s.Smolvm, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("smolvm %s: %w: %s", strings.Join(args[:2], " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("writing response", "error", err)
	}
}
