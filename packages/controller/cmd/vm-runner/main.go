package main

import (
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

func main() {
	listen := flag.String("listen", ":4600", "address to serve the machine API on")
	stateDir := flag.String("state-dir", "/var/lib/vm-runner", "per-machine state (published port, CA file, applied spec) and local image archives under images/")
	smolvm := flag.String("smolvm", "smolvm", "smolvm binary")
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
		Token: strings.TrimSpace(string(token)), StateDir: *stateDir, Runtime: &vmrunner.Smolvm{Bin: *smolvm},
		PortMin: *portMin, PortMax: *portMax, MemoryMiB: *memory, ReserveMiB: *reserve,
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
	for _, dir := range []string{os.Getenv("HOME"), *stateDir} {
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
		slog.Error("republishing machines", "error", err)
		os.Exit(1)
	}
	slog.Info("VM runner serving", "listen", *listen, "stateDir", *stateDir, "tls", *tlsCert != "")
	if *tlsCert != "" {
		err = http.ListenAndServeTLS(*listen, *tlsCert, *tlsKey, srv.Handler())
	} else {
		err = http.ListenAndServe(*listen, srv.Handler())
	}
	slog.Error("serving", "error", err)
	os.Exit(1)
}
