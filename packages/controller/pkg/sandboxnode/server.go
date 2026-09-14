package sandboxnode

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	guestAgentPort = 8080
	loopbackOffset = 1000
	opTimeout      = 30 * time.Minute
)

var machineID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type Server struct {
	Token     string
	StateDir  string
	Runtime   Runtime
	PortMin   int
	PortMax   int
	AllowFrom []*net.IPNet

	mu        sync.Mutex
	locks     map[string]*sync.Mutex
	pending   map[string]string
	lastErr   map[string]string
	listeners map[string]net.Listener
}

func (s *Server) Start() error {
	s.locks, s.pending, s.lastErr, s.listeners = map[string]*sync.Mutex{}, map[string]string{}, map[string]string{}, map[string]net.Listener{}
	entries, err := os.ReadDir(filepath.Join(s.StateDir, "machines"))
	if err != nil && !os.IsNotExist(err) {
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

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
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
	if op := s.plan(id, spec, st); op != "" {
		s.spawn(id, op, func() error { return s.ensure(id, spec) })
		st.State = op
	}
	writeJSON(w, st)
}

func (s *Server) plan(id string, spec MachineSpec, st MachineStatus) string {
	switch st.State {
	case StateAbsent:
		if spec.Running {
			return StateCreating
		}
	case StateStopped:
		if spec.Running {
			return StateStarting
		}
	case StateRunning:
		if !spec.Running {
			return StateStopping
		}
		if applied := s.readSpec(id); applied == nil || needsRestart(*applied, spec) {
			return StateRestarting
		}
	}
	return ""
}

func needsRestart(applied, desired MachineSpec) bool {
	return applied.Revision != desired.Revision || applied.CACert != desired.CACert || applied.CPUs != desired.CPUs ||
		applied.MemoryMiB != desired.MemoryMiB || applied.StorageGiB < desired.StorageGiB || !reflect.DeepEqual(applied.Env, desired.Env)
}

func (s *Server) ensure(id string, spec MachineSpec) error {
	state := s.Runtime.State(id)
	if !spec.Running {
		if state == StateRunning {
			return s.Runtime.Stop(id)
		}
		return nil
	}
	if err := s.writeCA(id, spec.CACert); err != nil {
		return err
	}
	if state == StateAbsent {
		if err := s.create(id, spec); err != nil {
			return err
		}
		return s.writeSpec(id, spec)
	}
	applied := s.readSpec(id)
	if state == StateRunning && (applied == nil || needsRestart(*applied, spec)) {
		if err := s.Runtime.Stop(id); err != nil {
			return err
		}
		state = StateStopped
	}
	if state == StateStopped {
		if err := s.Runtime.Update(id, spec, applied); err != nil {
			return err
		}
		if err := s.Runtime.Start(id); err != nil {
			return err
		}
	}
	return s.writeSpec(id, spec)
}

func (s *Server) create(id string, spec MachineSpec) error {
	port, err := s.allocatePort(id)
	if err != nil {
		return err
	}
	image := spec.Image
	if archive := filepath.Join(s.StateDir, "images", strings.NewReplacer("/", "_", ":", "_", "@", "_").Replace(image)+".tar"); fileExists(archive) {
		image = archive
	}
	if err := s.Runtime.Create(id, spec, image, port+loopbackOffset, filepath.Join(s.machineDir(id), "ca")); err != nil {
		return err
	}
	if err := s.forward(id, port); err != nil {
		return err
	}
	return s.Runtime.Start(id)
}

func (s *Server) writeCA(id, ca string) error {
	dir := filepath.Join(s.machineDir(id), "ca")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "ca.crt"), []byte(ca), 0o644)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.status(r.PathValue("id")))
}

func (s *Server) delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	lock := s.lock(id)
	lock.Lock()
	defer lock.Unlock()
	if s.Runtime.State(id) != StateAbsent {
		if err := s.Runtime.Delete(id); err != nil {
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

func (s *Server) lock(id string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.locks[id]
	if !ok {
		l = &sync.Mutex{}
		s.locks[id] = l
	}
	return l
}

func (s *Server) spawn(id, op string, fn func() error) {
	s.mu.Lock()
	s.pending[id] = op
	s.mu.Unlock()
	go func() {
		lock := s.lock(id)
		lock.Lock()
		defer lock.Unlock()
		err := fn()
		s.mu.Lock()
		delete(s.pending, id)
		if err != nil {
			s.lastErr[id] = err.Error()
			slog.Error("machine operation failed", "machine", id, "op", op, "error", err)
		} else {
			delete(s.lastErr, id)
		}
		s.mu.Unlock()
	}()
}

func (s *Server) status(id string) MachineStatus {
	s.mu.Lock()
	pending, lastErr := s.pending[id], s.lastErr[id]
	s.mu.Unlock()
	st := MachineStatus{State: StateAbsent, Port: s.port(id), Message: lastErr}
	if spec := s.readSpec(id); spec != nil {
		st.CPUs, st.MemoryMiB, st.StorageGiB = spec.CPUs, spec.MemoryMiB, spec.StorageGiB
	}
	if pending != "" {
		st.State = pending
		return st
	}
	st.State = s.Runtime.State(id)
	if st.State == StateRunning {
		st.Ready = s.healthy(st.Port)
	}
	return st
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

func (s *Server) forward(id string, port int) error {
	s.mu.Lock()
	_, exists := s.listeners[id]
	s.mu.Unlock()
	if exists {
		return nil
	}
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("publishing machine %s on :%d: %w", id, port, err)
	}
	s.mu.Lock()
	s.listeners[id] = ln
	s.mu.Unlock()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			if !s.allowed(conn.RemoteAddr()) {
				conn.Close()
				continue
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

func (s *Server) allowed(addr net.Addr) bool {
	if len(s.AllowFrom) == 0 {
		return true
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	for _, n := range s.AllowFrom {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func (s *Server) allocatePort(id string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p := s.port(id); p != 0 {
		return p, nil
	}
	used := map[int]bool{}
	entries, _ := os.ReadDir(filepath.Join(s.StateDir, "machines"))
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

func (s *Server) readSpec(id string) *MachineSpec {
	b, err := os.ReadFile(filepath.Join(s.machineDir(id), "spec.json"))
	if err != nil {
		return nil
	}
	var spec MachineSpec
	if json.Unmarshal(b, &spec) != nil {
		return nil
	}
	return &spec
}

func (s *Server) writeSpec(id string, spec MachineSpec) error {
	spec.Running = false
	b, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.machineDir(id), "spec.json"), b, 0o600)
}

func (s *Server) machineDir(id string) string { return filepath.Join(s.StateDir, "machines", id) }

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
