// UNIT_BOUNDARY_DESCRIPTION: the guest the machine API conformance suite boots. The suite sees a machine only through the machine API, whose one signal from inside the guest is Ready — the runner's own GET of /healthz on the guest's agent port. So this guest turns what the suite needs to know into that signal: it reads what its disk held at boot, and answers /healthz with 200 only if that matches what its environment says to expect. A runner that lost the disk across a stop, or kept it across a delete, then has a machine that never becomes ready. It also reports a boot id on /boot, so a caller that can reach the published port can tell a restarted guest from the one it had.
package vmprobe

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	EnvWrite       = "CONFORMANCE_WRITE"
	EnvExpect      = "CONFORMANCE_EXPECT"
	EnvExpectEmpty = "CONFORMANCE_EXPECT_EMPTY"
	EnvDir         = "CONFORMANCE_DIR"
	MarkerFile     = ".conformance-marker"
	BootPath       = "/boot"
)

type Guest struct {
	Dir         string
	Write       string
	Expect      string
	ExpectEmpty bool
}

func FromEnv(getenv func(string) string) Guest {
	g := Guest{
		Dir:         getenv(EnvDir),
		Write:       getenv(EnvWrite),
		Expect:      getenv(EnvExpect),
		ExpectEmpty: getenv(EnvExpectEmpty) != "",
	}
	if g.Dir == "" {
		g.Dir = vmrunner.AgentHome
	}
	return g
}

// UNIT_BOUNDARY_DESCRIPTION: the marker is read before it is written, so a guest told both to write and to expect is judged on what the disk held when it booted and not on its own write.
func (g Guest) Boot() (http.Handler, error) {
	marker := filepath.Join(g.Dir, MarkerFile)
	held, err := os.ReadFile(marker)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	found := strings.TrimSpace(string(held))
	if g.Write != "" {
		if err := os.MkdirAll(g.Dir, 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(marker, []byte(g.Write), 0o644); err != nil {
			return nil, err
		}
	}
	problem := ""
	switch {
	case g.Expect != "" && found != g.Expect:
		problem = fmt.Sprintf("the disk held %q at boot, expected %q", found, g.Expect)
	case g.ExpectEmpty && found != "":
		problem = fmt.Sprintf("the disk held %q at boot, expected nothing", found)
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	boot := hex.EncodeToString(id)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		if problem != "" {
			http.Error(w, problem, http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET "+BootPath, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(boot))
	})
	return mux, nil
}

func Serve(address string, g Guest) error {
	handler, err := g.Boot()
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	return http.Serve(ln, handler)
}
