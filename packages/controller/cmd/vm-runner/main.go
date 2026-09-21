package main

import (
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"

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
	srv := &vmrunner.Server{
		Token: strings.TrimSpace(string(token)), StateDir: *stateDir, ImageDir: *imageDir, Runtime: &vmrunner.Smolvm{Bin: *smolvm},
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
	go srv.Runtime.WarmTemplates()
	slog.Info("VM runner serving", "listen", *listen, "stateDir", *stateDir, "imageDir", *imageDir, "tls", *tlsCert != "", "platformInit", *initBin)
	if *tlsCert != "" {
		err = http.ListenAndServeTLS(*listen, *tlsCert, *tlsKey, srv.Handler())
	} else {
		err = http.ListenAndServe(*listen, srv.Handler())
	}
	slog.Error("serving", "error", err)
	os.Exit(1)
}
