package reconciler

import (
	"encoding/binary"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TEST_OVERVIEW: the machine resolver, run as the real CoreDNS the gateway
// TEST_OVERVIEW: ships. A template whose regular expression does not match answers SERVFAIL
// TEST_OVERVIEW: instead of falling to the rule below it, so one exact name answered without
// TEST_OVERVIEW: `fallthrough` breaks every other lookup in every machine of the install — a
// TEST_OVERVIEW: failure no reading of the Corefile catches. This starts the binary on a
// TEST_OVERVIEW: rendered Corefile and asks the questions that matter: the install's own
// TEST_OVERVIEW: Service answers with the gateway, a public name keeps the path every name
// TEST_OVERVIEW: takes, another cluster-internal name is NXDOMAIN, and TXT is refused. It runs
// TEST_OVERVIEW: only when COREDNS_BIN names a CoreDNS binary — `mise run
// TEST_OVERVIEW: //packages/controller:machine-dns` supplies one from the gateway's image —
// TEST_OVERVIEW: because the repository ships neither the binary nor a network.

func TestMachineResolver_RealCoreDNS(t *testing.T) {
	bin := os.Getenv("COREDNS_BIN")
	if bin == "" {
		t.Skip("COREDNS_BIN unset: run this through mise run //packages/controller:test:machine-dns")
	}

	const gateway = "10.43.9.9"
	host := bootstrapTestCfg.APIServerHost()
	dir := t.TempDir()
	corefile := filepath.Join(dir, "Corefile")
	port := freeUDPPort(t)
	require.NoError(t, os.WriteFile(corefile, []byte(
		ownerResolverCorefile([]ownerResolverBlock{{Port: port, ClusterIP: gateway, ClusterService: host}}),
	), 0o600))

	cmd := exec.Command(bin, "-conf", corefile)
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	require.NoError(t, cmd.Start())
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	server := fmt.Sprintf("127.0.0.1:%d", port)
	require.Eventually(t, func() bool {
		got := answer(t, server, host, dnsTypeA)
		return got != nil && got.Rcode == dnsRcodeOK
	}, 10*time.Second, 100*time.Millisecond, "CoreDNS never answered on %s", server)

	// TEST_SCENARIO: the install's own Service answers with the gateway's address, over A and with an empty AAAA, so the Agent's TLS reaches the gateway that terminates it.
	service := answer(t, server, host, dnsTypeA)
	require.NotNil(t, service)
	assert.Equal(t, dnsRcodeOK, service.Rcode)
	assert.Equal(t, []string{gateway}, service.A)
	aaaa := answer(t, server, host, dnsTypeAAAA)
	require.NotNil(t, aaaa)
	assert.Equal(t, dnsRcodeOK, aaaa.Rcode)
	assert.Empty(t, aaaa.AAAA, "an empty AAAA makes the client fall back to IPv4")

	// TEST_SCENARIO: a name that could be public still gets the gateway, as every name did before this one was answered — the exception must not swallow the path the rest of the machine depends on.
	public := answer(t, server, "github.com", dnsTypeA)
	require.NotNil(t, public)
	assert.Equal(t, dnsRcodeOK, public.Rcode, "a public name must not fail because an exact-name rule declined it")
	assert.Equal(t, []string{gateway}, public.A)

	// TEST_SCENARIO: another cluster-internal name does not exist, so a cluster inside the machine keeps its own Services.
	other := answer(t, server, "api.default.svc.cluster.local", dnsTypeA)
	require.NotNil(t, other)
	assert.Equal(t, dnsRcodeName, other.Rcode)

	// TEST_SCENARIO: a type that could carry an answer back is refused, so the resolver never becomes a channel.
	txt := answer(t, server, "example.com", dnsTypeTXT)
	require.NotNil(t, txt)
	assert.Equal(t, dnsRcodeDeny, txt.Rcode)
}

func freeUDPPort(t *testing.T) int {
	t.Helper()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	require.NoError(t, err)
	defer func() { _ = conn.Close() }()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

const (
	dnsTypeA     = 1
	dnsTypeAAAA  = 28
	dnsTypeTXT   = 16
	dnsClassIN   = 1
	dnsRcodeOK   = 0
	dnsRcodeName = 3
	dnsRcodeDeny = 5
)

type dnsAnswer struct {
	Rcode  int
	A      []string
	AAAA   []string
	Counts int
}

/* UNIT_BOUNDARY_DESCRIPTION: the smallest DNS client that can tell one answer from another — one question over UDP, and a parse of the header, the A/AAAA addresses and the response code — because the repository carries no DNS library and the resolver check must not add a dependency. */
func answer(t *testing.T, server, name string, qtype uint16) *dnsAnswer {
	t.Helper()
	query := newDNSQuery(t, name, qtype)
	conn, err := net.Dial("udp", server)
	if err != nil {
		return nil
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	if _, err := conn.Write(query); err != nil {
		return nil
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil
	}
	return parseDNSAnswer(t, buf[:n])
}

func newDNSQuery(t *testing.T, name string, qtype uint16) []byte {
	t.Helper()
	out := make([]byte, 12, 12+len(name)+6)
	binary.BigEndian.PutUint16(out[0:], 0x1234)
	binary.BigEndian.PutUint16(out[2:], 0x0100)
	binary.BigEndian.PutUint16(out[4:], 1)
	for _, label := range splitLabels(name) {
		out = append(out, byte(len(label)))
		out = append(out, label...)
	}
	out = append(out, 0)
	out = binary.BigEndian.AppendUint16(out, qtype)
	out = binary.BigEndian.AppendUint16(out, dnsClassIN)
	return out
}

func splitLabels(name string) []string {
	var out []string
	start := 0
	for i := 0; i < len(name); i++ {
		if name[i] == '.' {
			if i > start {
				out = append(out, name[start:i])
			}
			start = i + 1
		}
	}
	if start < len(name) {
		out = append(out, name[start:])
	}
	return out
}

func parseDNSAnswer(t *testing.T, msg []byte) *dnsAnswer {
	t.Helper()
	require.GreaterOrEqual(t, len(msg), 12)
	out := &dnsAnswer{
		Rcode:  int(msg[3] & 0x0f),
		Counts: int(binary.BigEndian.Uint16(msg[6:])),
	}
	questions := int(binary.BigEndian.Uint16(msg[4:]))
	offset := 12
	for i := 0; i < questions; i++ {
		offset = skipName(msg, offset)
		offset += 4
	}
	for i := 0; i < out.Counts; i++ {
		offset = skipName(msg, offset)
		require.GreaterOrEqual(t, len(msg), offset+10)
		rtype := binary.BigEndian.Uint16(msg[offset:])
		rdlength := int(binary.BigEndian.Uint16(msg[offset+8:]))
		data := msg[offset+10:]
		require.GreaterOrEqual(t, len(data), rdlength)
		switch rtype {
		case dnsTypeA:
			require.Equal(t, 4, rdlength)
			out.A = append(out.A, net.IP(data[:4]).String())
		case dnsTypeAAAA:
			require.Equal(t, 16, rdlength)
			out.AAAA = append(out.AAAA, net.IP(data[:16]).String())
		}
		offset += 10 + rdlength
	}
	return out
}

func skipName(msg []byte, offset int) int {
	for offset < len(msg) {
		length := int(msg[offset])
		if length == 0 {
			return offset + 1
		}
		if length&0xc0 == 0xc0 {
			return offset + 2
		}
		offset += 1 + length
	}
	return offset
}
