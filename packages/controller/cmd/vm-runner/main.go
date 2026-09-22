package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func main() {
	listen := flag.String("listen", ":4600", "address to serve the machine API on")
	stateDir := flag.String("state-dir", "/var/lib/platform/machines", "per-machine state: published port, applied spec, and the share each guest reads its plan, CA and platform-init from")
	imageDir := flag.String("image-dir", "/var/lib/platform/images", "unpacked agent images and local archives, shared by every runner on this node when the install gives them a host directory")
	runnerID := flag.String("runner-id", "", "this runner's name among the runners sharing the image directory; empty keeps the cache private to this runner")
	imageBudget := flag.Int64("image-budget-bytes", 0, "bytes the cached images may occupy; 0 evicts nothing, and the controller refuses to start a runner without a positive budget")
	smolvm := flag.String("smolvm", "smolvm", "smolvm binary")
	crane := flag.String("crane", "crane", "crane binary, used to fetch an agent image the shared cache does not hold (empty disables the fetch)")
	initBin := flag.String("platform-init", "/usr/local/libexec/platform-init", "platform-init binary, copied into every machine's share and run as its entrypoint")
	portMin := flag.Int("port-min", 31000, "first port machines are published on")
	portMax := flag.Int("port-max", 31099, "last port machines are published on")
	memory := flag.Int("memory-mib", 0, "memory the runner may commit to machines; required")
	reserve := flag.Int("reserve-mib", 512, "memory kept for the runner itself when admitting a machine")
	tokenFile := flag.String("token-file", "/etc/vm-runner/token", "bearer token the controller authenticates with")
	tlsCert := flag.String("tls-cert", "", "TLS certificate for the machine API (plain HTTP when unset)")
	tlsKey := flag.String("tls-key", "", "TLS key for the machine API")
	allowFrom := flag.String("allow-from", "", "comma-separated CIDRs allowed to dial published machine ports (empty = any)")
	flag.Parse()

	token, err := os.ReadFile(*tokenFile)
	if err != nil || strings.TrimSpace(string(token)) == "" {
		slog.Error("reading token file", "path", *tokenFile, "error", err)
		os.Exit(1)
	}
	runtime := &vmrunner.Smolvm{Bin: *smolvm}
	// UNIT_BOUNDARY_DESCRIPTION: HOME is the runner's claim, so templates expanded under it survive a pod roll. It is beside smolvm's own directories there rather than inside them, so nothing smolvm lists or cleans up can take one.
	if home := os.Getenv("HOME"); home != "" {
		runtime.TemplateDir = filepath.Join(home, ".disk-templates")
	}
	srv := &vmrunner.Server{
		Token: strings.TrimSpace(string(token)), StateDir: *stateDir, ImageDir: *imageDir, Runtime: runtime,
		PortMin: *portMin, PortMax: *portMax, MemoryMiB: *memory, ReserveMiB: *reserve,
		Crane: *crane, Init: *initBin, RunnerID: *runnerID, ImageBudget: *imageBudget,
	}
	for _, c := range strings.Split(*allowFrom, ",") {
		if c = strings.TrimSpace(c); c != "" {
			_, n, err := net.ParseCIDR(c)
			if err != nil {
				slog.Error("parsing --allow-from", "cidr", c, "error", err)
				os.Exit(1)
			}
			srv.AllowFrom = append(srv.AllowFrom, n)
		}
	}
	if *memory <= 0 {
		slog.Error("--memory-mib is required: without it the runner admits machines against no limit at all")
		os.Exit(1)
	}
	for _, dev := range []string{"/dev/kvm", "/dev/net/tun"} {
		if err := os.Chmod(dev, 0o666); err != nil {
			slog.Warn("device not writable for machine uids", "path", dev, "error", err)
		}
	}
	for _, dir := range []string{os.Getenv("HOME"), *stateDir, *imageDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			slog.Error("creating state dir", "path", dir, "error", err)
			os.Exit(1)
		}
		if err := os.Chmod(dir, 0o755); err != nil {
			slog.Error("opening state dir to machine uids", "path", dir, "error", err)
			os.Exit(1)
		}
	}
	if err := srv.Start(); err != nil {
		slog.Error("reading the machines already in the state dir", "error", err)
		os.Exit(1)
	}
	srv.Background(srv.Runtime.WarmTemplates)
	slog.Info("VM runner serving", "listen", *listen, "stateDir", *stateDir, "imageDir", *imageDir, "tls", *tlsCert != "", "platformInit", *initBin)

	// UNIT_BOUNDARY_DESCRIPTION: a runner that ignores SIGTERM is killed where it stands, thirty seconds later and without warning, and everything it was part-way through is abandoned as it lies — a fetch unpacking into a scratch directory leaves that directory behind, in a node directory that outlives every pod and where nothing counts it against the image budget or ever evicts it. Answering the signal is what lets the runner close itself: its in-flight work is cancelled rather than severed, and each operation unwinds its own cleanup on the way out.
	stopping := make(chan os.Signal, 1)
	signal.Notify(stopping, syscall.SIGTERM, syscall.SIGINT)

	api := &http.Server{Addr: *listen, Handler: srv.Handler()}
	serving := make(chan error, 1)
	go func() {
		if *tlsCert != "" {
			serving <- api.ListenAndServeTLS(*tlsCert, *tlsKey)
			return
		}
		serving <- api.ListenAndServe()
	}()

	select {
	case err := <-serving:
		slog.Error("serving", "error", err)
		srv.Close()
		os.Exit(1)
	case sig := <-stopping:
		slog.Info("VM runner stopping", "signal", sig.String())
	}

	// UNIT_BOUNDARY_DESCRIPTION: the API goes first so nothing new is admitted, then the runner, which cancels what is running and waits for it. The machines are not stopped here and they do not survive either: they are smolvm's processes in this pod's namespace, so the pod going away takes them with it and the controller's sweep starts them again. What this sequence is for is the runner's own half-finished work — a scratch tree being unpacked, a machine directory being written — which a SIGKILL would leave for the next start to find.
	shutdown, done := context.WithTimeout(context.Background(), shutdownGrace)
	defer done()
	if err := api.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Warn("the machine API did not shut down cleanly", "error", err)
	}
	srv.Close()
	slog.Info("VM runner stopped")
}

// UNIT_BOUNDARY_DESCRIPTION: how long the machine API is given to finish the requests it already has. Comfortably inside the thirty seconds kubelet allows before it escalates to SIGKILL, so the runner's own close still gets a turn after it.
const shutdownGrace = 5 * time.Second
