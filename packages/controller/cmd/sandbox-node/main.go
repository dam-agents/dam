package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/kagenti/platform/packages/controller/pkg/sandboxnode"
)

func main() {
	listen := flag.String("listen", ":4600", "address to serve the machine API on")
	stateDir := flag.String("state-dir", "/var/lib/platform-sandbox", "per-machine state (published port, CA file) and local image archives under images/")
	smolvm := flag.String("smolvm", "smolvm", "smolvm binary")
	portMin := flag.Int("port-min", 31000, "first node port machines are published on")
	portMax := flag.Int("port-max", 31099, "last node port machines are published on")
	tokenFile := flag.String("token-file", "/etc/platform-sandbox/token", "bearer token the controller authenticates with")
	flag.Parse()

	token, err := os.ReadFile(*tokenFile)
	if err != nil || strings.TrimSpace(string(token)) == "" {
		slog.Error("reading token file", "path", *tokenFile, "error", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(*stateDir, 0o755); err != nil {
		slog.Error("creating state dir", "path", *stateDir, "error", err)
		os.Exit(1)
	}
	srv := &sandboxnode.Server{
		Token: strings.TrimSpace(string(token)), StateDir: *stateDir, Smolvm: *smolvm,
		PortMin: *portMin, PortMax: *portMax,
	}
	if err := srv.Start(); err != nil {
		slog.Error("republishing machines", "error", err)
		os.Exit(1)
	}
	slog.Info("sandbox node serving", "listen", *listen, "stateDir", *stateDir)
	if err := http.ListenAndServe(*listen, srv.Handler()); err != nil {
		slog.Error("serving", "error", err)
		os.Exit(1)
	}
}
