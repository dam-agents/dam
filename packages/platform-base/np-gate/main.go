// waits for:
// - GATEWAY_IP:ENVOY_PORT to be **reachable**
// - KUBERNETES_SERVICE_HOST:KUBERNETES_SERVICE_PORT to be **unreachable**

package main

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

const (
	// Per-connect deadline. A silent NetworkPolicy DROP surfaces as a timeout
	// after this elapses; mirrors the old `nc -w 2`.
	dialTimeout = 2 * time.Second
	// Gap between convergence checks. OVN-K typically converges in well under
	// a second; this keeps the loop cheap without adding meaningful latency.
	pollInterval = 300 * time.Millisecond
	// Fallback when TIMEOUT_SECONDS is unset/unparseable. Matches the
	// controller default.
	defaultTimeoutSeconds = 30
)

func main() {
	denied := net.JoinHostPort(os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT"))
	allowed := net.JoinHostPort(os.Getenv("GATEWAY_IP"), os.Getenv("ENVOY_PORT"))
	timeoutSeconds := defaultTimeoutSeconds
	if v, err := strconv.Atoi(os.Getenv("TIMEOUT_SECONDS")); err == nil && v > 0 {
		timeoutSeconds = v
	}

	fmt.Printf("np-gate: probing denied=%s allowed=%s, deadline=%ds\n", denied, allowed, timeoutSeconds)

	deadline := time.Now().Add(time.Duration(timeoutSeconds) * time.Second)
	for time.Now().Before(deadline) {
		if !reachable(denied) && reachable(allowed) {
			fmt.Printf("np-gate: NetworkPolicy enforced (denied %s blocked, gateway %s reachable)\n", denied, allowed)
			os.Exit(0)
		}
		time.Sleep(pollInterval)
	}

	fmt.Fprintf(os.Stderr, "np-gate: FATAL — NetworkPolicy did not converge within %ds (denied=%s allowed=%s)\n", timeoutSeconds, denied, allowed)
	os.Exit(1)
}

// reachable reports whether a TCP connection to addr completes within
// dialTimeout. A silent DROP (NetworkPolicy) surfaces as a timeout → false; a
// RST (connection refused) also → false. Because the kube-apiserver target is
// always-listening, this returns true before the NP lands and only flips to
// false once the SYN is DROPped — the distinction the gate relies on.
func reachable(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, dialTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
