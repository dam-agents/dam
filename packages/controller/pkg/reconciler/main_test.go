package reconciler

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"testing"
)

var offMachine struct {
	mu   sync.Mutex
	sent []string
}

func refuseOffMachine(req *http.Request) (*url.URL, error) {
	host := req.URL.Hostname()
	if ip := net.ParseIP(host); host == "localhost" || (ip != nil && ip.IsLoopback()) {
		return nil, nil
	}
	offMachine.mu.Lock()
	offMachine.sent = append(offMachine.sent, req.Method+" "+req.URL.String())
	offMachine.mu.Unlock()
	return nil, fmt.Errorf("test sent a request off the machine: %s %s", req.Method, req.URL)
}

func TestMain(m *testing.M) {
	guard := http.DefaultTransport.(*http.Transport).Clone()
	guard.Proxy = refuseOffMachine
	http.DefaultTransport = guard
	code := m.Run()
	if len(offMachine.sent) > 0 {
		fmt.Fprintln(os.Stderr, "tests sent requests off the machine; stub the call instead:")
		for _, r := range offMachine.sent {
			fmt.Fprintln(os.Stderr, "  "+r)
		}
		code = 1
	}
	os.Exit(code)
}
