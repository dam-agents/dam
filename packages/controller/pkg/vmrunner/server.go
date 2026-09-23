package vmrunner

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	guestAgentPort   = 8080
	loopbackOffset   = 1000
	opTimeout        = 30 * time.Minute
	stateTTL         = time.Second
	unhealthyRestart = 10 * time.Minute
	pullTimeout      = 20 * time.Minute
	maxImageConfig   = 1 << 20
	rootfsDir        = "rootfs"
	launchFile       = "launch.json"
	shareDir         = "share"

	// UNIT_BOUNDARY_DESCRIPTION: where a runner records which cached images its own machines hold, so the runners sharing a node directory can see each other's claims. A runner reads only its own machines — they are its child processes — so on a shared directory its in-use set is a third of the answer, and evicting on it alone takes a running guest's root filesystem away from a machine belonging to somebody else.
	holdersDir = ".holders"
	// UNIT_BOUNDARY_DESCRIPTION: how long a holders file is believed after its last write. Machines are processes of the runner that made them, so a runner that stopped refreshing has no machines left running and its claims are safe to ignore — the window only has to outlast the gap between two reconciles, which the controller drives about once a minute.
	holderStale = 30 * time.Minute
	// UNIT_BOUNDARY_DESCRIPTION: how long Close waits for the machine operations already running. Long enough for any operation that is not stuck behind a registry, short enough that a shutdown is still a shutdown.
	closeGrace = 30 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress is named apart from a finished entry, and dot-prefixed so the two patterns below cannot match it — a half-written tree must never be counted as one a machine can boot. Nothing finishes an unpack after twice the time one is allowed to take, so a directory older than that belonged to a process that died holding it, and the bytes are the directory's to reclaim.
	partialPrefix = ".unpack-"
	partialStale  = 2 * pullTimeout
)

var machineID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type failure struct{ message, reason string }

// UNIT_BOUNDARY_DESCRIPTION: a machine is restarted only once it has answered at least once and then gone quiet for longer than any legitimate boot, so both halves are read together and neither means anything alone.
type health struct {
	everReady  bool
	quietSince time.Time
}

type cachedState struct {
	state string
	at    time.Time
}

// UNIT_BOUNDARY_DESCRIPTION: the volume is shared, so its listing is not all ours — anything that does not look like an image this runner cached is left alone rather than counted against the budget or deleted, and its name never reaches a log line. Two shapes count: the directory a cached image is now, and the archive an earlier release left, which still boots.
var cachedImage = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$`)

var cachedArchive = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}\.tar$`)

var imageRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$`)

type Server struct {
	Token      string
	StateDir   string
	ImageDir   string
	Runtime    *Smolvm
	PortMin    int
	PortMax    int
	MemoryMiB  int
	ReserveMiB int
	AllowFrom  []*net.IPNet
	Crane      string
	Init       string
	// UNIT_BOUNDARY_DESCRIPTION: this runner's name in the holders directory, unique among the runners that may share an image directory with it.
	RunnerID string
	// UNIT_BOUNDARY_DESCRIPTION: bytes the cached images may occupy, wherever they live. There is no filesystem-share fallback: a node directory shares its filesystem with everything else the node runs, and the runner's own claim shares one with the machine disks, so a share of either would let the images eat something that is not theirs.
	ImageBudget int64
	// UNIT_BOUNDARY_DESCRIPTION: cache entries this process keeps whatever the budget says, named by image reference. A runner's own claims are its machines, read from their specs on disk; the preloader has no machines and holds this list instead, which is what lets an image nobody is running yet survive the eviction that would otherwise take it first.
	Pinned []string
	// UNIT_BOUNDARY_DESCRIPTION: how a machine's published port is opened, nil being net.Listen. It exists so a caller that has already bound the port can hand that listener over rather than release it and hope: between releasing a port and this binding it, anything on the host may take it, and the machine then fails to publish for a reason that has nothing to do with it.
	Listen func(network, address string) (net.Listener, error)

	// UNIT_BOUNDARY_DESCRIPTION: the runner's own lifetime, written once by Start and cancelled by Close, so every fetch and every smolvm call is a child of it. Without one they are children of nothing and outlive the runner by up to their own timeout — twenty minutes for a pull — which is how a killed process leaves a half-unpacked tree its own deferred cleanup never reached.
	ctx    context.Context
	cancel context.CancelFunc

	mu sync.Mutex
	// UNIT_BOUNDARY_DESCRIPTION: operations started and not yet finished. A machine operation runs on its own goroutine and writes to the state and image directories throughout, so a process that stops without waiting for them leaves work running against directories its caller believes are finished with — which is how a test's temporary directory is removed out from under a fetch still unpacking into it.
	work       sync.WaitGroup
	closed     bool
	locks      map[string]*sync.Mutex
	pending    map[string]string
	seq        map[string]uint64
	committing map[string]int
	failures   map[string]failure
	listeners  map[string]net.Listener
	gens       map[string]uint64
	restarts   map[string]int32
	health     map[string]health
	lastState  map[string]cachedState
	startedAt  map[string]time.Time
	// UNIT_BOUNDARY_DESCRIPTION: machines this runner last saw running, with the memory each was started with. Admission reads this instead of asking smolvm about every other machine on every PUT. It is kept true by every start and stop this runner makes, by every state it reads from smolvm, and, on a restarted runner, by one read of each machine in Start.
	running map[string]int
}

// UNIT_BOUNDARY_DESCRIPTION: the lifetime every operation of this runner hangs off. Background when Start has not run, which is the Preloader: it drives this cache code with no runner behind it. Nothing here bounds a pass of its own — its interval bounds the gap between passes, not a pass — so a fetch it starts ends at the pull timeout and at nothing else.
func (s *Server) lifetime() context.Context {
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *Server) Start() error {
	if s.ctx == nil {
		s.ctx, s.cancel = context.WithCancel(context.Background())
	}
	if s.Runtime != nil && s.Runtime.Lifetime == nil {
		s.Runtime.Lifetime = s.ctx
	}
	s.locks, s.pending, s.failures, s.listeners = map[string]*sync.Mutex{}, map[string]string{}, map[string]failure{}, map[string]net.Listener{}
	s.gens, s.health = map[string]uint64{}, map[string]health{}
	s.restarts, s.committing, s.seq = map[string]int32{}, map[string]int{}, map[string]uint64{}
	s.lastState, s.startedAt, s.running = map[string]cachedState{}, map[string]time.Time{}, map[string]int{}
	ids, err := s.machineIDs()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if s.Runtime != nil {
			s.observeAtStart(id)
		}
		if p := s.port(id); p != 0 {
			if err := s.forward(id, p); err != nil {
				slog.Warn("republishing machine port", "machine", id, "error", err)
			}
		}
	}
	s.publishHolders()
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: stops taking new machine operations, drops the published ports, and waits for the operations already running — which is the part that was missing. Those goroutines fetch images and drive smolvm against the state and image directories, so returning while they run hands the caller a runner that is still writing. The wait is bounded because an operation may be inside a pull that is allowed twenty minutes, and a shutdown that can hang that long behind one slow registry is its own failure; going on without them is reported rather than silent. The bound is a backstop rather than the mechanism: the operations are cancelled before the wait, so what the grace actually covers is work that does not answer cancellation.
func (s *Server) Close() {
	s.mu.Lock()
	s.closed = true
	for id, ln := range s.listeners {
		ln.Close()
		delete(s.listeners, id)
	}
	s.mu.Unlock()

	// UNIT_BOUNDARY_DESCRIPTION: cancelling before waiting is what makes the wait short. An operation inside a pull is allowed twenty minutes on its own; as a child of this it ends now, unwinds its own deferred cleanup, and the scratch tree it was unpacking into goes with it rather than being left for the directory's housekeeping to find later.
	if s.cancel != nil {
		s.cancel()
	}

	done := make(chan struct{})
	go func() {
		s.work.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(closeGrace):
		slog.Warn("vm runner: machine operations were still running when the runner closed", "grace", closeGrace.String())
	}

	// UNIT_BOUNDARY_DESCRIPTION: an operation still running through the wait above reaches its own publish, and binds a port into a map this already emptied. Exactly the operations being waited for are the ones that can do it, so the sweep belongs after the wait and not instead of it: without it a runner that closed cleanly still holds a port for as long as the process lives.
	s.mu.Lock()
	for id, ln := range s.listeners {
		ln.Close()
		delete(s.listeners, id)
	}
	s.mu.Unlock()
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
	entries, err := os.ReadDir(s.StateDir)
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
		if applied == nil || needsRestart(*applied, spec) || imageChanged(*applied, spec) {
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
		applied.MemoryMiB != desired.MemoryMiB || applied.StorageGiB < desired.StorageGiB ||
		!reflect.DeepEqual(applied.Env, desired.Env)
}

// UNIT_BOUNDARY_DESCRIPTION: a new image is a restart like a resize, but smolvm cannot apply it in place, so the machine is recreated around the same storage disk. Nothing else needs to survive: the root is the cached image tree plus an overlay that every stop discards, so everything the agent keeps is on that disk.
func imageChanged(applied, desired MachineSpec) bool {
	return applied.Image != desired.Image
}

// UNIT_BOUNDARY_DESCRIPTION: the allowlist is the gateway's ClusterIP, and Kubernetes reuses those — a machine still holding an address its gateway no longer owns may be pointing at another owner's gateway, so it is stopped rather than run on.
func egressChanged(applied, desired MachineSpec) bool {
	return !reflect.DeepEqual(applied.AllowCIDRs, desired.AllowCIDRs)
}

func (s *Server) ensure(id string, spec MachineSpec, restart, unhealthy bool) error {
	if !machineID.MatchString(id) {
		return fmt.Errorf("invalid machine id %q", id)
	}
	defer s.publishHolders()
	state, err := s.machineState(id)
	if err != nil {
		return err
	}
	if !spec.Running {
		if state == StateRunning {
			return s.stop(id)
		}
		return nil
	}
	if err := s.writeShare(id, spec); err != nil {
		return err
	}
	if state == StateAbsent {
		if applied := s.readSpec(id); applied != nil && s.Runtime.HasKeptStorage(id) {
			spec.StorageGiB = min(spec.StorageGiB, applied.StorageGiB)
		}
		if err := s.create(id, spec); err != nil {
			return err
		}
		return s.writeSpec(id, spec)
	}
	applied := s.readSpec(id)
	if applied != nil && egressChanged(*applied, spec) {
		if state == StateRunning {
			if err := s.stop(id); err != nil {
				return err
			}
		}
		return fmt.Errorf("%w: this machine may only reach %v, but its gateway is now %v — recreate the agent",
			errEgressChanged, applied.AllowCIDRs, spec.AllowCIDRs)
	}
	if applied != nil && imageChanged(*applied, spec) {
		return s.recreate(id, spec, *applied, state)
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
		if err := s.stop(id); err != nil {
			return err
		}
		state = StateStopped
	}
	if state == StateStopped {
		s.forgetState(id)
		if err := s.Runtime.Update(id, spec, applied); err != nil {
			return err
		}
		if err := s.start(id, spec.MemoryMiB); err != nil {
			return err
		}
	}
	return s.writeSpec(id, spec)
}

func (s *Server) create(id string, spec MachineSpec) error {
	boot, err := s.resolve(id, spec)
	if err != nil {
		return err
	}
	return s.boot(id, spec, boot)
}

// UNIT_BOUNDARY_DESCRIPTION: the new image is fetched and its launch read while the old machine still runs, so the agent is down only for the stop, the recreate and the boot, and not for a pull. A pull that fails leaves the old machine as it was. The port file is kept, so the recreated machine publishes on the port its Service already maps to. The machine is created at the disk size it already has: a kept qcow2 disk is opened as it is and never grown at start, so a larger size would be recorded and not given. The stored spec keeps that size, and the next reconcile grows the disk with the in-place update like any other resize. The old image is still held while this runs, because the machine's stored spec and recorded digest name it until the new machine has booted; both are rewritten only after that, and the holders published after them release the old image.
func (s *Server) recreate(id string, spec, applied MachineSpec, state string) error {
	spec.StorageGiB = min(spec.StorageGiB, applied.StorageGiB)
	boot, err := s.resolve(id, spec)
	if err != nil {
		return err
	}
	s.forgetState(id)
	if state == StateRunning {
		if err := s.Runtime.Stop(id); err != nil {
			return err
		}
	}
	if err := s.Runtime.DeleteKeepingStorage(id); err != nil {
		return err
	}
	if err := s.boot(id, spec, boot); err != nil {
		return err
	}
	return s.writeSpec(id, spec)
}

// UNIT_BOUNDARY_DESCRIPTION: what a machine boots, decided before anything about the machine changes: its published port, the image source smolvm is handed, what that image says to run, and the digest it was resolved to.
type bootSource struct {
	port   int
	image  string
	launch *ImageLaunch
	digest string
}

func (s *Server) resolve(id string, spec MachineSpec) (bootSource, error) {
	port, err := s.allocatePort(id)
	if err != nil {
		return bootSource{}, err
	}
	image := spec.Image
	if !imageRef.MatchString(image) {
		return bootSource{}, fmt.Errorf("invalid image reference %q", image)
	}
	if strings.Contains(image, "..") {
		return bootSource{}, fmt.Errorf("invalid image reference %q", image)
	}
	digest := s.resolveDigest(image, refFresh)
	cached, launch, fetchErr := s.digestImage(id, image, digest)
	if launch == nil {
		if cached, launch, err = s.legacyImage(image); err != nil {
			return bootSource{}, err
		}
		if launch != nil {
			digest = ""
		}
	}
	if launch == nil && fetchErr != nil {
		return bootSource{}, fetchErr
	}
	if launch == nil {
		if digest != "" {
			image = repository(image) + "@" + digest
		}
		if launch, err = s.launchFromRegistry(image); err != nil {
			return bootSource{}, err
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a tree with no launch beside it is never handed to smolvm, however it came to be there — the registry reference is used instead, which needs no cache and still boots. Falling back to such a tree would produce the very failure the launch exists to prevent, and silently, since a machine given one starts and merely runs nothing.
	if cached != "" {
		if _, err := os.Stat(cached); err == nil {
			image = cached
		}
	}
	return bootSource{port: port, image: image, launch: launch, digest: digest}, nil
}

func (s *Server) boot(id string, spec MachineSpec, source bootSource) error {
	if err := s.recordDigest(id, source.digest); err != nil {
		return err
	}
	dir, err := s.machineDir(id)
	if err != nil {
		return err
	}
	s.forgetState(id)
	if err := s.Runtime.Create(id, spec, source.image, source.port+loopbackOffset, filepath.Join(dir, shareDir), source.launch); err != nil {
		return err
	}
	if err := s.forward(id, source.port); err != nil {
		return err
	}
	return s.start(id, spec.MemoryMiB)
}

// UNIT_BOUNDARY_DESCRIPTION: platform-init is the machine's entrypoint, and it execs the image's own — so what the image says to run has to be known before the machine is created, on every path that reaches a boot. A cached tree carries it beside the files and an archive carries it inside, but a machine booting straight from a registry reference has neither, and smolvm would read the config itself and launch the image's entrypoint directly, leaving the disk unmounted. One config fetch costs no layers and answers it. An install that disabled the fetch is refused rather than booted without persistence: what it would save is a machine whose work does not survive its first stop.
func (s *Server) launchFromRegistry(ref string) (*ImageLaunch, error) {
	if s.Crane == "" {
		return nil, fmt.Errorf("%w: %s names no cached image and this runner cannot read one from the registry", errImageLaunchUnknown, ref)
	}
	ctx, cancel := context.WithTimeout(s.lifetime(), pullTimeout)
	defer cancel()
	config, err := exec.CommandContext(ctx, s.Crane, "config", ref).Output()
	if err != nil {
		return nil, fmt.Errorf("%w: reading the config of %s: %w", errImageUnusable, ref, err)
	}
	launch, err := launchFromConfig(config)
	if err != nil {
		return nil, fmt.Errorf("%w: reading the config of %s: %w", errImageUnusable, ref, err)
	}
	return launch, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a tool that fails per entry reports per entry, and for a whole image that ran to 2.6 MB when the runner still unpacked one itself. That text becomes the Agent's condition message, and a condition message over 32 KiB is rejected by the API server — so the status write fails rather than the create: the reconcile never records why, retries, and each retry fetches the image again. The cap belongs to the boundary rather than to the tool behind it, which is why it outlived the unpack that found it. Keeping the head keeps the first failure, which is the one that explains the rest.
const capturedOutput = 2000

func firstLines(out string) string {
	out = strings.TrimSpace(out)
	if len(out) <= capturedOutput {
		return out
	}
	return out[:capturedOutput] + "… (truncated)"
}

// UNIT_BOUNDARY_DESCRIPTION: a machine may reach only its gateway, so the guest cannot pull its own image — the runner fetches it here instead, onto the cache it shares with any runner mounting the same directory, so the handful of images nearly every owner runs is fetched once per cache rather than once per machine. It is unpacked once too: smolvm mounts a tree as a read-only lower layer every machine of that image shares, where an archive is unpacked again into each machine's own disk — seconds of boot and a gigabyte of disk per machine, for bytes that are identical. A tree alone is not enough to boot, because it carries files and not the entrypoint, environment and working directory the image names, so those are read with it and written beside it; without that record smolvm launches nothing and the guest comes up with no harness in it.
func (s *Server) cacheImage(ref, cached, forMachine string) error {
	if err := os.MkdirAll(filepath.Dir(cached), 0o755); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(filepath.Dir(cached), partialPrefix+"*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := os.Mkdir(filepath.Join(tmp, rootfsDir), 0o755); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(s.lifetime(), pullTimeout)
	defer cancel()
	started := time.Now()
	config, err := exec.CommandContext(ctx, s.Crane, "config", ref).Output()
	if err != nil {
		slog.Warn("image config fetch failed", "image", ref, "duration_ms", time.Since(started).Milliseconds())
		return fmt.Errorf("%w: reading the config of %s: %w", errImageUnusable, ref, err)
	}
	launch, err := launchFromConfig(config)
	if err != nil {
		return fmt.Errorf("%w: reading the config of %s: %w", errImageUnusable, ref, err)
	}
	if err := s.unpack(ctx, ref, filepath.Join(tmp, rootfsDir)); err != nil {
		return err
	}
	encoded, err := json.Marshal(launch)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(tmp, launchFile), encoded, 0o644); err != nil {
		return err
	}
	slog.Info("image unpacked into the shared cache", "image", ref, "duration_ms", time.Since(started).Milliseconds(), "bytes", dirSize(tmp))
	if err := s.claim(tmp, cached, forMachine); err != nil {
		return err
	}
	s.evictImages(s.ImageDir, cached, s.ImageBudget)
	return nil
}

func (s *Server) unpack(ctx context.Context, ref, rootfs string) error {
	export := exec.CommandContext(ctx, s.Crane, "export", ref, "-")
	unpack := exec.CommandContext(ctx, "tar", "-x", "-C", rootfs)
	stream, err := export.StdoutPipe()
	if err != nil {
		return err
	}
	unpack.Stdin = stream
	var exportErr, unpackErr bytes.Buffer
	export.Stderr, unpack.Stderr = &exportErr, &unpackErr
	if err := unpack.Start(); err != nil {
		return err
	}
	if err := export.Run(); err != nil {
		_ = unpack.Wait()
		slog.Warn("image fetch failed", "image", ref)
		return fmt.Errorf("exporting %s: %w: %s", ref, err, firstLines(exportErr.String()))
	}
	if err := unpack.Wait(); err != nil {
		slog.Warn("image unpack failed", "image", ref)
		return fmt.Errorf("unpacking %s: %w: %s", ref, err, firstLines(unpackErr.String()))
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: runners share this volume and may unpack the same image at once, so the loser of the rename finds the winner's entry already there and keeps it — both wrote the same image. What it may also find is a tree from the release that stored no launch beside it, and that is not a winner but an entry no machine can boot: it is replaced rather than kept, or the first runner to meet one leaves every machine of that image booting a rootfs that names nothing to run. Replaced only if no other machine is running from it — the machine being created is not other, since a restarted runner recreates machines whose specs it still holds, and reading its own spec as somebody's claim would leave it unable to bring back exactly what it lost.
func (s *Server) claim(tmp, cached, forMachine string) error {
	err := os.Rename(tmp, cached)
	if !errors.Is(err, fs.ErrExist) && !errors.Is(err, syscall.ENOTEMPTY) {
		return err
	}
	if complete, readErr := readLaunch(cached); readErr == nil && complete != nil {
		return nil
	}
	if s.imagesInUse(forMachine)[cached] || s.heldElsewhere(s.ImageDir)[cached] {
		return fmt.Errorf("%s is the image of a machine that is already running, and it predates the launch this release records beside a tree: stop that machine before creating another from this image", filepath.Base(cached))
	}
	if err := os.RemoveAll(cached); err != nil {
		return err
	}
	return os.Rename(tmp, cached)
}

// UNIT_BOUNDARY_DESCRIPTION: the launch is written beside the tree rather than inside it, because anything inside is the guest's root filesystem and would show up in it. Its presence is also what marks a cache entry complete — a directory without one is an unpack from the release that stored only files, which names nothing to run and is never booted — replaced when the image is fetched again, or left to eviction if some machine is still running from it.
func readLaunch(cached string) (*ImageLaunch, error) {
	encoded, err := os.ReadFile(filepath.Join(cached, launchFile))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var launch ImageLaunch
	if err := json.Unmarshal(encoded, &launch); err != nil {
		return nil, err
	}
	return &launch, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an archive boots a machine without a tree beside it, but it carries the image's own config as well as its layers, and that is where the entrypoint, environment and working directory live. smolvm reads the layers out of it and not the config, so a machine handed an archive and nothing else comes up with its filesystem and no process — the same silent failure the launch record exists to prevent, on the path the record does not reach. Entries are held only while they could still be that config: a layer is skipped by its size, and anything that is not an object by its first byte.
func launchFromArchive(path string) (*ImageLaunch, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var manifest []byte
	documents := map[string][]byte{}
	reader := tar.NewReader(f)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading the archive %s: %w", path, err)
		}
		if header.Typeflag != tar.TypeReg || header.Size > maxImageConfig {
			continue
		}
		body, err := io.ReadAll(reader)
		if err != nil {
			return nil, fmt.Errorf("reading the archive %s: %w", path, err)
		}
		name := strings.TrimPrefix(filepath.Clean(header.Name), "./")
		if name == "manifest.json" {
			manifest = body
			continue
		}
		if len(body) > 0 && body[0] == '{' {
			documents[name] = body
		}
	}

	var entries []struct{ Config string }
	if err := json.Unmarshal(manifest, &entries); err != nil {
		return nil, fmt.Errorf("reading the manifest of %s: %w", path, err)
	}
	if len(entries) == 0 || entries[0].Config == "" {
		return nil, fmt.Errorf("the archive %s names no image config", path)
	}
	config, held := documents[strings.TrimPrefix(filepath.Clean(entries[0].Config), "./")]
	if !held {
		return nil, fmt.Errorf("the archive %s is missing its image config %s", path, entries[0].Config)
	}
	return launchFromConfig(config)
}

func launchFromConfig(config []byte) (*ImageLaunch, error) {
	var parsed struct {
		Config struct {
			Entrypoint []string `json:"Entrypoint"`
			Cmd        []string `json:"Cmd"`
			Env        []string `json:"Env"`
			WorkingDir string   `json:"WorkingDir"`
		} `json:"config"`
	}
	if err := json.Unmarshal(config, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Config.Entrypoint) == 0 && len(parsed.Config.Cmd) == 0 {
		return nil, errors.New("the image names neither an entrypoint nor a command")
	}
	return &ImageLaunch{
		Entrypoint: parsed.Config.Entrypoint,
		Cmd:        parsed.Config.Cmd,
		Env:        parsed.Config.Env,
		WorkingDir: parsed.Config.WorkingDir,
	}, nil
}

func dirSize(path string) int64 {
	var total int64
	_ = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, statErr := d.Info(); statErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

// UNIT_BOUNDARY_DESCRIPTION: nothing else prunes this volume and every deploy adds an image under a fresh tag, so it would fill and then refuse every machine. Oldest first by modification time, down to the byte count the install states — there is no share-of-the-volume fallback, because the cache may sit on a node directory it does not own. Unlinking an archive a machine is still reading is safe: the open descriptor outlives the name.
func (s *Server) cachePath(image string) string {
	return filepath.Join(s.ImageDir, strings.NewReplacer("/", "_", ":", "_", "@", "_").Replace(image))
}

// UNIT_BOUNDARY_DESCRIPTION: an unpacked image is not a spare a machine consumes at create, it is the read-only lower layer every machine of that image keeps mounted for as long as it runs — so deleting one to make room takes the running guests' filesystem out from under them. Which images are spoken for is read from the machines themselves rather than tracked alongside them, because the runner is restarted and its memory is not: a spec on disk outlives the process that wrote it, and a machine whose image is missing from this set is a machine about to lose its rootfs.
func (s *Server) imagesInUse(except string) map[string]bool {
	inUse := map[string]bool{}
	ids, err := s.machineIDs()
	if err != nil {
		return inUse
	}
	for _, id := range ids {
		if id == except {
			continue
		}
		if digest := s.recordedDigest(id); digest != "" {
			inUse[s.digestPath(digest)] = true
		}
		spec := s.readSpec(id)
		if spec == nil || spec.Image == "" {
			continue
		}
		base := s.cachePath(spec.Image)
		inUse[base], inUse[base+".tar"] = true, true
	}
	return inUse
}

// UNIT_BOUNDARY_DESCRIPTION: publishes what this runner's machines hold, so a runner sharing the node's image directory can be seen by the others. One file per runner rather than one per image, because it is rewritten whole from the machines on disk and a whole rewrite cannot leave a claim behind for a machine that is gone. Its mtime is the liveness signal, so a file is refreshed even when the set did not change. Failure is logged and not returned: a runner that cannot publish its claims still runs its machines, and the cost is that another runner may evict an image it holds.
func (s *Server) publishHolders() {
	if s.RunnerID == "" {
		return
	}
	dir := filepath.Join(s.ImageDir, holdersDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Warn("image cache: cannot publish this runner's claims", "error", err)
		return
	}
	held := s.imagesInUse("")
	for path := range s.pinnedImages() {
		held[path] = true
	}
	names := make([]string, 0, len(held))
	for path := range held {
		if name, err := filepath.Rel(s.ImageDir, path); err == nil && !strings.HasPrefix(name, "..") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	path := filepath.Join(dir, s.RunnerID)
	staged := path + ".new"
	if err := os.WriteFile(staged, []byte(strings.Join(names, "\n")), 0o644); err != nil {
		slog.Warn("image cache: cannot publish this runner's claims", "error", err)
		return
	}
	if err := os.Rename(staged, path); err != nil {
		_ = os.Remove(staged)
		slog.Warn("image cache: cannot publish this runner's claims", "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: every other runner's claims on the shared directory, keyed the way evictImages keys its entries. This runner's own file is skipped, because every caller already reads the machines on disk directly and that read is both current and able to make the exception the published snapshot cannot: a recreate excludes the machine it is bringing back, and answering it with this runner's own published claim on that same machine would refuse the image forever, on the one path that can replace a launch-less tree. Eviction loses nothing by the skip, reading the same machines unfiltered. A file older than holderStale is skipped and deleted: its runner is gone, and with it the machines that were holding those images, so keeping the claims would pin images nothing can boot from. A file this runner cannot read is treated as holding everything it names nothing about — that is, skipped — because guessing narrower is what deletes somebody's rootfs.
func (s *Server) heldElsewhere(dir string) map[string]bool {
	held := map[string]bool{}
	entries, err := os.ReadDir(filepath.Join(dir, holdersDir))
	if err != nil {
		return held
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".new") {
			continue
		}
		if s.RunnerID != "" && e.Name() == s.RunnerID {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(dir, holdersDir, e.Name())
		if time.Since(info.ModTime()) > holderStale {
			_ = os.Remove(path)
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, name := range strings.Split(string(body), "\n") {
			if name = strings.TrimSpace(name); name != "" {
				held[filepath.Join(dir, name)] = true
			}
		}
	}
	return held
}

// UNIT_BOUNDARY_DESCRIPTION: a fetch unpacks beside the entry it will become and removes that scratch tree on its way out, which a process that is killed never reaches — and a node directory outlives every process that writes to it, so what a kill leaves is nobody's until something goes looking. It is invisible as well as abandoned: the patterns above cannot match a dot-prefixed name, so those bytes are neither counted against the budget nor ever chosen for eviction. Reclaiming them is therefore the first thing eviction does, before it measures anything. Only a tree older than any fetch may run is taken, so a fetch still running elsewhere on the node keeps its own.
func prunePartialUnpacks(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), partialPrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) <= partialStale {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dir, e.Name())); err != nil {
			slog.Warn("image cache: reclaiming what an interrupted fetch left behind", "path", e.Name(), "error", err)
		}
	}
}

func (s *Server) evictImages(dir, keep string, budget int64) {
	prunePartialUnpacks(dir)
	prunePartialUnpacks(filepath.Join(dir, digestRoot))
	defer pruneRefs(dir)
	if budget <= 0 {
		return
	}
	inUse := s.imagesInUse("")
	for path := range s.pinnedImages() {
		inUse[path] = true
	}
	for path := range s.heldElsewhere(dir) {
		inUse[path], inUse[path+".tar"] = true, true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type archive struct {
		path string
		size int64
		mod  time.Time
	}
	var all []archive
	var used int64
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(dir, e.Name())
		var size int64
		switch {
		case e.IsDir() && cachedImage.MatchString(e.Name()):
			size = dirSize(path)
		case !e.IsDir() && cachedArchive.MatchString(e.Name()):
			size = info.Size()
		default:
			continue
		}
		used += size
		all = append(all, archive{path, size, info.ModTime()})
	}
	digests, _ := os.ReadDir(filepath.Join(dir, digestRoot))
	for _, e := range digests {
		info, err := e.Info()
		if err != nil || !e.IsDir() || !digestEntry.MatchString(e.Name()) {
			continue
		}
		path := filepath.Join(dir, digestRoot, e.Name())
		size := dirSize(path)
		used += size
		all = append(all, archive{path, size, info.ModTime()})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].mod.Before(all[j].mod) })
	for _, a := range all {
		if used <= budget {
			return
		}
		if a.path == keep || inUse[a.path] {
			continue
		}
		if err := os.RemoveAll(a.path); err != nil {
			continue
		}
		used -= a.size
		slog.Info("image cache: evicted an image to stay inside the volume", "image", filepath.Base(a.path), "bytes", a.size)
	}
	if used > budget {
		slog.Warn("image cache: over its stated budget, and every image left is one a machine is running from",
			"bytes", used, "budget", budget)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the one thing a machine gets from its runner other than its disks. It holds platform-init and the CA the guest must trust, and it is rewritten on every ensure so a CA the controller has rotated is the CA the next boot trusts — the share is a live host directory, while the command line that names it is fixed at create. platform-init is copied rather than linked because the guest reads this directory through the VMM, which has no host filesystem to follow a link into.
func (s *Server) writeShare(id string, spec MachineSpec) error {
	base, err := s.machineDir(id)
	if err != nil {
		return err
	}
	share := filepath.Join(base, shareDir)
	if err := os.MkdirAll(filepath.Join(share, "ca"), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(share, "ca", "ca.crt"), []byte(spec.CACert), 0o644); err != nil {
		return err
	}
	return s.copyInit(filepath.Join(share, "init"))
}

func (s *Server) copyInit(to string) error {
	if s.Init == "" {
		return errors.New("no platform-init binary configured, so a machine would boot with its disk unmounted")
	}
	source, err := os.Open(s.Init)
	if err != nil {
		return fmt.Errorf("reading platform-init: %w", err)
	}
	defer source.Close()
	staged := to + ".new"
	destination, err := os.OpenFile(staged, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(destination, source); err != nil {
		_ = destination.Close()
		_ = os.Remove(staged)
		return err
	}
	if err := destination.Close(); err != nil {
		_ = os.Remove(staged)
		return err
	}
	return os.Rename(staged, to)
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
	if err := s.Runtime.DiscardKeptStorage(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
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
	delete(s.restarts, id)
	delete(s.health, id)
	delete(s.lastState, id)
	delete(s.startedAt, id)
	delete(s.running, id)
	if ln := s.listeners[id]; ln != nil {
		ln.Close()
		delete(s.listeners, id)
	}
	s.mu.Unlock()
	s.publishHolders()
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

// UNIT_BOUNDARY_DESCRIPTION: work the runner has out that belongs to no machine — the disk-template warm-up, which is a decompression the first create would otherwise pay for. It joins the same barrier as a machine operation so that "cancels what is running and waits for it" is true of everything and not of most things: the runner's lifetime cancels it, and Close does not return while it is unwinding. A caller that arrives after Close is refused for the same reason a machine operation is, since there is nothing left to wait for it.
func (s *Server) Background(fn func()) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.work.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.work.Done()
		fn()
	}()
}

// UNIT_BOUNDARY_DESCRIPTION: a second operation can be queued behind the one running, so each clears only its own markers — otherwise a finishing boot erases the pending stop queued behind it and the machine reads as settled while the stop has not run.
func (s *Server) spawn(id, op string, fn func() error) {
	s.mu.Lock()
	if s.closed {
		// UNIT_BOUNDARY_DESCRIPTION: the caller reserved this machine's memory before asking for the operation, and the goroutine that releases the reservation is the one being refused here. Leaving it would have roomFor counting a machine that never starts, against a runner that is going away — and, on a runner that comes back to the same state, against nothing at all.
		delete(s.committing, id)
		s.mu.Unlock()
		return
	}
	s.seq[id]++
	seq := s.seq[id]
	s.pending[id] = op
	s.health[id] = health{everReady: s.health[id].everReady}
	gen := s.gens[id]
	s.work.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.work.Done()
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

// UNIT_BOUNDARY_DESCRIPTION: stamped each time this runner asks a machine to start, and reported as the age of that stamp. It is the clock the controller watches a starting machine by, because it moves for a wake as well as a create — a wake leaves the Ready condition False and changes only its reason, so that condition's own stamp cannot tell the two apart.
func (s *Server) markStarting(id string) {
	s.mu.Lock()
	s.startedAt[id] = time.Now()
	s.mu.Unlock()
}

// UNIT_BOUNDARY_DESCRIPTION: asking smolvm for a machine's state costs a process, and the controller asks on every readiness poll — often enough, while a machine starts, that the spawns cost more than the answer is worth. The answer barely moves at that rate, so a reading is reused for a moment. Only the state is reused: whether the guest answers is checked live every time, so a machine that dies is still noticed by the health check rather than waiting out this window.
func (s *Server) forgetState(id string) {
	s.mu.Lock()
	delete(s.lastState, id)
	s.mu.Unlock()
}

func (s *Server) machineState(id string) (string, error) {
	s.mu.Lock()
	cached, ok := s.lastState[id]
	s.mu.Unlock()
	if ok && time.Since(cached.at) < stateTTL {
		return cached.state, nil
	}
	state, err := s.Runtime.State(id)
	if err != nil {
		return state, err
	}
	s.observe(id, state)
	s.mu.Lock()
	s.lastState[id] = cachedState{state: state, at: time.Now()}
	s.mu.Unlock()
	return state, nil
}

func (s *Server) stop(id string) error {
	s.forgetState(id)
	defer s.forgetState(id)
	if err := s.Runtime.Stop(id); err != nil {
		return err
	}
	s.observe(id, StateStopped)
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: a start that fails has already killed whatever VMM it left, so the machine stops counting against the runner's memory; the next state read corrects that if it is wrong.
func (s *Server) start(id string, memoryMiB int) error {
	s.markStarting(id)
	if err := s.Runtime.Start(id); err != nil {
		s.observe(id, StateStopped)
		return err
	}
	s.mu.Lock()
	s.running[id] = memoryMiB
	s.mu.Unlock()
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: records a state read from smolvm. A running machine this runner did not start itself, which is one it found after a restart, is counted at the memory its applied spec names.
func (s *Server) observe(id, state string) {
	if state != StateRunning {
		s.mu.Lock()
		delete(s.running, id)
		s.mu.Unlock()
		return
	}
	s.mu.Lock()
	_, known := s.running[id]
	s.mu.Unlock()
	if known {
		return
	}
	memoryMiB := 0
	if applied := s.readSpec(id); applied != nil {
		memoryMiB = applied.MemoryMiB
	}
	s.mu.Lock()
	if _, known := s.running[id]; !known {
		s.running[id] = memoryMiB
	}
	s.mu.Unlock()
}

func (s *Server) status(id string) MachineStatus {
	s.mu.Lock()
	pending, restarts := s.pending[id], s.restarts[id]
	failed := s.failures[id]
	lastErr, reason := failed.message, failed.reason
	s.mu.Unlock()
	st := MachineStatus{State: StateAbsent, Reason: reason, Restarts: restarts, Port: s.port(id), Message: lastErr}
	s.mu.Lock()
	startedAt := s.startedAt[id]
	s.mu.Unlock()
	if !startedAt.IsZero() {
		st.StartingMs = time.Since(startedAt).Milliseconds()
	}
	if spec := s.readSpec(id); spec != nil {
		st.CPUs, st.MemoryMiB = spec.CPUs, spec.MemoryMiB
	}
	if pending != "" {
		st.State = pending
	} else {
		state, err := s.machineState(id)
		if err != nil {
			st.State = StateUnknown
			if st.Message == "" {
				st.Message = err.Error()
			}
			return st
		}
		st.State = state
	}
	// UNIT_BOUNDARY_DESCRIPTION: a guest that answers its health check is up, whatever the operation that started it still has left to do — and the runtime's own start call lingers seconds past the moment the guest begins serving, which the platform used to spend telling a user their agent was not ready yet. Only a machine on its way up is read this way: a restart's old guest answers until the stop lands, and a machine being stopped answers until it dies, so neither may be called ready on the strength of an answer.
	if st.State == StateRunning || st.State == StateCreating || st.State == StateStarting {
		st.Ready = s.healthy(st.Port)
	}
	if st.State == StateRunning {
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
	ln, err := s.listen("tcp", fmt.Sprintf(":%d", port))
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

func (s *Server) listen(network, address string) (net.Listener, error) {
	if s.Listen != nil {
		return s.Listen(network, address)
	}
	return net.Listen(network, address)
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
	entries, _ := os.ReadDir(s.StateDir)
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
	return filepath.Join(s.StateDir, id), nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("writing response", "error", err)
	}
}

var errEgressChanged = errors.New("egress allowlist changed")

var errImageUnusable = errors.New("the image cannot be run")

func failureReason(err error) string {
	if errors.Is(err, errEgressChanged) {
		return ReasonEgressChanged
	}
	if errors.Is(err, errImageUnusable) {
		return ReasonImageUnavailable
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

// UNIT_BOUNDARY_DESCRIPTION: admission counts what the runner already knows — memory reserved by operations in flight and the machines it last saw running — so a PUT costs no subprocess. A machine can also die on its own, and the runner then still counts it until the next state read. So a refusal is checked once more against smolvm before it is given: the fork per machine is paid only by the PUT that would otherwise be refused.
func (s *Server) roomFor(id string, spec MachineSpec) error {
	limit := s.MemoryMiB
	if limit == 0 {
		return nil
	}
	used := s.committed(id)
	if used+spec.MemoryMiB+s.ReserveMiB > limit {
		s.recheckRunning(id)
		used = s.committed(id)
	}
	if used+spec.MemoryMiB+s.ReserveMiB > limit {
		return fmt.Errorf("this machine's %d MiB does not fit: the VM runner has %d MiB for machines and %d MiB is already committed; stop another agent or give the runner more memory",
			spec.MemoryMiB, limit-s.ReserveMiB, used)
	}
	return nil
}

func (s *Server) committed(except string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	used := 0
	for other, mib := range s.committing {
		if other != except {
			used += mib
		}
	}
	for other, mib := range s.running {
		if _, inFlight := s.committing[other]; other != except && !inFlight {
			used += mib
		}
	}
	return used
}

// UNIT_BOUNDARY_DESCRIPTION: a machine that cannot be read when the runner starts is counted as running at its applied size. Leaving it out would count its memory as nothing, and admission would then let in a machine that does not fit, which is what admission exists to prevent. Counting it errs the other way, and a refusal rechecks it against smolvm before it is given.
func (s *Server) observeAtStart(id string) {
	state, err := s.Runtime.State(id)
	if err != nil {
		slog.Warn("could not read a machine's state at start; counting it as running until a read succeeds", "machine", id, "error", err)
		state = StateRunning
	}
	s.observe(id, state)
}

// UNIT_BOUNDARY_DESCRIPTION: asks smolvm about every machine this runner has, not only the ones it counts, so that a machine it holds as stopped but that is running after all is counted before a refusal is given.
func (s *Server) recheckRunning(except string) {
	all, _ := s.machineIDs()
	s.mu.Lock()
	ids := make([]string, 0, len(all)+len(s.running))
	for other := range s.running {
		if _, inFlight := s.committing[other]; other != except && !inFlight {
			ids = append(ids, other)
		}
	}
	for _, other := range all {
		_, counted := s.running[other]
		if _, inFlight := s.committing[other]; other != except && !inFlight && !counted {
			ids = append(ids, other)
		}
	}
	s.mu.Unlock()
	for _, other := range ids {
		s.forgetState(other)
		_, _ = s.machineState(other)
	}
}
