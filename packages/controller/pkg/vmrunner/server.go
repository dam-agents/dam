package vmrunner

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
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	guestAgentPort   = 8080
	loopbackOffset   = 1000
	opTimeout        = 30 * time.Minute
	unhealthyRestart = 10 * time.Minute
)

var machineID = regexp.MustCompile(`^[^/]+$`)

type failure struct{ message, reason string }

// UNIT_BOUNDARY_DESCRIPTION: a machine is restarted only once it has answered at least once and then gone quiet for longer than any legitimate boot, so both halves are read together and neither means anything alone.
type health struct {
	everReady  bool
	quietSince time.Time
}

var imageRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$`)

type Server struct {
	Token      string
	StateDir   string
	Runtime    *Smolvm
	PortMin    int
	PortMax    int
	MemoryMiB  int
	ReserveMiB int
	AllowFrom  []*net.IPNet

	mu         sync.Mutex
	locks      map[string]*sync.Mutex
	pending    map[string]string
	seq        map[string]uint64
	committing map[string]int
	failures   map[string]failure
	listeners  map[string]net.Listener
	gens       map[string]uint64
	drift      map[string]string
	restarts   map[string]int32
	health     map[string]health
}

func (s *Server) Start() error {
	s.locks, s.pending, s.failures, s.listeners = map[string]*sync.Mutex{}, map[string]string{}, map[string]failure{}, map[string]net.Listener{}
	s.gens, s.drift, s.health = map[string]uint64{}, map[string]string{}, map[string]health{}
	s.restarts, s.committing, s.seq = map[string]int32{}, map[string]int{}, map[string]uint64{}
	ids, err := s.machineIDs()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if p := s.port(id); p != 0 {
			if err := s.forward(id, p); err != nil {
				slog.Warn("republishing machine port", "machine", id, "error", err)
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
	mux.HandleFunc("GET /machines", s.auth(s.list))
	mux.HandleFunc("PUT /machines/{id}", s.guard(s.put))
	mux.HandleFunc("GET /machines/{id}", s.guard(s.get))
	mux.HandleFunc("DELETE /machines/{id}", s.guard(s.delete))
	return mux
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if !machineID.MatchString(r.PathValue("id")) {
			http.Error(w, "invalid machine id", http.StatusBadRequest)
			return
		}
		next(w, r)
	})
}

func (s *Server) list(w http.ResponseWriter, _ *http.Request) {
	ids, err := s.machineIDs()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, ids)
}

func (s *Server) machineIDs() ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(s.StateDir, "machines"))
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	ids := []string{}
	for _, e := range entries {
		if e.IsDir() && machineID.MatchString(e.Name()) {
			ids = append(ids, e.Name())
		}
	}
	return ids, nil
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
	if spec.Image != "" && (!imageRef.MatchString(spec.Image) || strings.Contains(spec.Image, "..")) {
		http.Error(w, "invalid image reference", http.StatusBadRequest)
		return
	}
	st := s.status(id)
	if op, unhealthy := s.plan(id, spec, st); op != "" {
		if op != StateStopping {
			if err := s.roomFor(id, spec); err != nil {
				s.mu.Lock()
				s.failures[id] = failure{err.Error(), ReasonOutOfCapacity}
				s.mu.Unlock()
				st.Message, st.Reason, st.Ready = err.Error(), ReasonOutOfCapacity, false
				writeJSON(w, st)
				return
			}
			s.mu.Lock()
			s.committing[id] = spec.MemoryMiB
			s.mu.Unlock()
		}
		restart := op == StateRestarting
		s.spawn(id, op, func() error { return s.ensure(id, spec, restart, unhealthy) })
		st.State, st.Ready = op, false
	}
	writeJSON(w, st)
}

// UNIT_BOUNDARY_DESCRIPTION: status reports an in-flight operation as the machine's state, so a stop that arrives mid-boot has to be planned against that too — the per-machine lock runs it after the boot rather than dropping it and leaving a machine nobody believes is running.
func (s *Server) plan(id string, spec MachineSpec, st MachineStatus) (string, bool) {
	if !spec.Running {
		if st.State == StateAbsent || st.State == StateStopped || st.State == StateStopping {
			return "", false
		}
		return StateStopping, false
	}
	applied := s.readSpec(id)
	if applied != nil && egressChanged(*applied, spec) && st.State != StateAbsent {
		if st.State == StateRunning {
			return StateStopping, false
		}
		return "", false
	}
	switch st.State {
	case StateAbsent:
		return StateCreating, false
	case StateStopped:
		return StateStarting, false
	case StateRunning:
		if applied == nil || needsRestart(*applied, spec) {
			return StateRestarting, false
		}
		if !st.Ready && s.deadForLong(id) {
			return StateRestarting, true
		}
	}
	return "", false
}

func (s *Server) deadForLong(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := s.health[id]
	return h.everReady && !h.quietSince.IsZero() && time.Since(h.quietSince) > unhealthyRestart
}

func needsRestart(applied, desired MachineSpec) bool {
	return applied.Revision != desired.Revision || applied.CACert != desired.CACert || applied.CPUs != desired.CPUs ||
		applied.MemoryMiB != desired.MemoryMiB || applied.StorageGiB < desired.StorageGiB || !reflect.DeepEqual(applied.Env, desired.Env)
}

func createOnlyDrift(applied, desired MachineSpec) string {
	if applied.Image == desired.Image {
		return ""
	}
	return fmt.Sprintf("the image is fixed at create, so this machine keeps what it has (recreate the agent to change it): image is %s, wanted %s", applied.Image, desired.Image)
}

// UNIT_BOUNDARY_DESCRIPTION: the allowlist is the gateway's ClusterIP, and Kubernetes reuses those — a machine still holding an address its gateway no longer owns may be pointing at another owner's gateway, so it is stopped rather than run on.
func egressChanged(applied, desired MachineSpec) bool {
	return !reflect.DeepEqual(applied.AllowCIDRs, desired.AllowCIDRs)
}

func (s *Server) ensure(id string, spec MachineSpec, restart, unhealthy bool) error {
	if !machineID.MatchString(id) {
		return fmt.Errorf("invalid machine id %q", id)
	}
	state, err := s.Runtime.State(id)
	if err != nil {
		return err
	}
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
	if applied != nil && egressChanged(*applied, spec) {
		if state == StateRunning {
			if err := s.Runtime.Stop(id); err != nil {
				return err
			}
		}
		return fmt.Errorf("%w: this machine may only reach %v, but its gateway is now %v — recreate the agent",
			errEgressChanged, applied.AllowCIDRs, spec.AllowCIDRs)
	}
	if applied != nil {
		drift := createOnlyDrift(*applied, spec)
		s.mu.Lock()
		if drift == "" {
			delete(s.drift, id)
		} else {
			s.drift[id] = drift
		}
		s.mu.Unlock()
		if drift != "" {
			slog.Warn("machine spec differs in a create-only field", "machine", id, "detail", strings.NewReplacer("\n", " ", "\r", " ").Replace(drift))
			spec.Image = applied.Image
		}
	}
	if p := s.port(id); p != 0 {
		if err := s.forward(id, p); err != nil {
			return err
		}
	}
	if state == StateRunning && (restart || applied == nil || needsRestart(*applied, spec)) {
		if unhealthy {
			s.mu.Lock()
			s.restarts[id]++
			s.mu.Unlock()
		}
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
	if !imageRef.MatchString(image) {
		return fmt.Errorf("invalid image reference %q", image)
	}
	if strings.Contains(image, "..") {
		return fmt.Errorf("invalid image reference %q", image)
	}
	archive := filepath.Join(s.StateDir, "images", strings.NewReplacer("/", "_", ":", "_", "@", "_").Replace(image)+".tar")
	if _, err := os.Stat(archive); err == nil {
		image = archive
	}
	dir, err := s.machineDir(id)
	if err != nil {
		return err
	}
	if err := s.Runtime.Create(id, spec, image, port+loopbackOffset, filepath.Join(dir, "ca")); err != nil {
		return err
	}
	if err := s.forward(id, port); err != nil {
		return err
	}
	return s.Runtime.Start(id)
}

func (s *Server) writeCA(id, ca string) error {
	base, err := s.machineDir(id)
	if err != nil {
		return err
	}
	dir := filepath.Join(base, "ca")
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
	s.mu.Lock()
	s.gens[id]++
	s.mu.Unlock()
	state, err := s.Runtime.State(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if state != StateAbsent {
		if err := s.Runtime.Delete(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	dir, err := s.machineDir(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	delete(s.failures, id)
	delete(s.drift, id)
	delete(s.restarts, id)
	delete(s.health, id)
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

// UNIT_BOUNDARY_DESCRIPTION: a second operation can be queued behind the one running, so each clears only its own markers — otherwise a finishing boot erases the pending stop queued behind it and the machine reads as settled while the stop has not run.
func (s *Server) spawn(id, op string, fn func() error) {
	s.mu.Lock()
	s.seq[id]++
	seq := s.seq[id]
	s.pending[id] = op
	s.health[id] = health{everReady: s.health[id].everReady}
	gen := s.gens[id]
	s.mu.Unlock()
	go func() {
		lock := s.lock(id)
		lock.Lock()
		defer lock.Unlock()
		s.mu.Lock()
		gone := s.gens[id] != gen
		s.mu.Unlock()
		var err error
		if !gone {
			err = fn()
		}
		s.mu.Lock()
		if s.seq[id] == seq {
			delete(s.pending, id)
			delete(s.committing, id)
		}
		if err != nil {
			s.failures[id] = failure{err.Error(), failureReason(err)}
			slog.Error("machine operation failed", "machine", id, "op", op, "error", err)
		} else {
			delete(s.failures, id)
		}
		s.mu.Unlock()
	}()
}

func (s *Server) status(id string) MachineStatus {
	s.mu.Lock()
	pending, drift, restarts := s.pending[id], s.drift[id], s.restarts[id]
	failed := s.failures[id]
	lastErr, reason := failed.message, failed.reason
	s.mu.Unlock()
	if lastErr == "" {
		lastErr = drift
	}
	st := MachineStatus{State: StateAbsent, Reason: reason, Restarts: restarts, Port: s.port(id), Message: lastErr}
	if spec := s.readSpec(id); spec != nil {
		st.CPUs, st.MemoryMiB = spec.CPUs, spec.MemoryMiB
	}
	if pending != "" {
		st.State = pending
		return st
	}
	state, err := s.Runtime.State(id)
	if err != nil {
		st.State = StateUnknown
		if st.Message == "" {
			st.Message = err.Error()
		}
		return st
	}
	st.State = state
	if st.State == StateRunning {
		st.Ready = s.healthy(st.Port)
		s.mu.Lock()
		h := s.health[id]
		if st.Ready {
			h = health{everReady: true}
		} else if h.quietSince.IsZero() {
			h.quietSince = time.Now()
		}
		s.health[id] = h
		s.mu.Unlock()
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
	dir, err := s.machineDir(id)
	if err != nil {
		return 0, err
	}
	for p := s.PortMin; p <= s.PortMax; p++ {
		if !used[p] {
			return p, os.WriteFile(filepath.Join(dir, "port"), []byte(strconv.Itoa(p)), 0o644)
		}
	}
	return 0, errors.New("no free machine port")
}

func (s *Server) port(id string) int {
	dir, err := s.machineDir(id)
	if err != nil {
		return 0
	}
	b, err := os.ReadFile(filepath.Join(dir, "port"))
	if err != nil {
		return 0
	}
	p, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return p
}

func (s *Server) readSpec(id string) *MachineSpec {
	dir, err := s.machineDir(id)
	if err != nil {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(dir, "spec.json"))
	if err != nil {
		return nil
	}
	var spec MachineSpec
	if json.Unmarshal(b, &spec) != nil {
		return nil
	}
	if spec.Image != "" && !imageRef.MatchString(spec.Image) {
		return nil
	}
	if strings.Contains(spec.Image, "..") {
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
	dir, err := s.machineDir(id)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "spec.json"), b, 0o600)
}

func (s *Server) machineDir(id string) (string, error) {
	if !machineID.MatchString(id) {
		return "", fmt.Errorf("invalid machine id %q", id)
	}
	return filepath.Join(s.StateDir, "machines", id), nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("writing response", "error", err)
	}
}

var errEgressChanged = errors.New("egress allowlist changed")

func failureReason(err error) string {
	if errors.Is(err, errEgressChanged) {
		return ReasonEgressChanged
	}
	m := err.Error()
	switch {
	case strings.Contains(m, "cannot read archive"), strings.Contains(m, "--image"), strings.Contains(m, "pull"):
		return ReasonImageUnavailable
	case strings.Contains(m, "no free machine port"):
		return ReasonOutOfCapacity
	default:
		return ReasonBootFailed
	}
}

func (s *Server) roomFor(id string, spec MachineSpec) error {
	limit := s.MemoryMiB
	if limit == 0 {
		limit = memoryLimitMiB()
	}
	if limit == 0 {
		return nil
	}
	ids, err := s.machineIDs()
	if err != nil {
		return err
	}
	s.mu.Lock()
	committing := make(map[string]int, len(s.committing))
	for k, v := range s.committing {
		committing[k] = v
	}
	s.mu.Unlock()
	for other := range committing {
		if !slices.Contains(ids, other) {
			ids = append(ids, other)
		}
	}
	used := 0
	for _, other := range ids {
		if other == id {
			continue
		}
		if mib, inFlight := committing[other]; inFlight {
			used += mib
			continue
		}
		if state, err := s.Runtime.State(other); err != nil || state != StateRunning {
			continue
		}
		if applied := s.readSpec(other); applied != nil {
			used += applied.MemoryMiB
		}
	}
	if used+spec.MemoryMiB+s.ReserveMiB > limit {
		return fmt.Errorf("this machine's %d MiB does not fit: the VM runner has %d MiB for machines and %d MiB is already committed; stop another agent or give the runner more memory",
			spec.MemoryMiB, limit-s.ReserveMiB, used)
	}
	return nil
}

func memoryLimitMiB() int {
	if b, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
		if v, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil {
			return int(v >> 20)
		}
	}
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kb, err := strconv.Atoi(fields[1])
		if err != nil {
			return 0
		}
		return kb >> 10
	}
	return 0
}
