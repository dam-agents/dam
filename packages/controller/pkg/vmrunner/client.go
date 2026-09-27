package vmrunner

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"syscall"
	"time"
)

var ErrUnauthorized = errors.New("the VM runner refused the controller's token")

type Client struct {
	URL  string
	HTTP *http.Client

	mu     sync.Mutex
	token  string
	reload func(context.Context) (string, error)
}

// UNIT_BOUNDARY_DESCRIPTION: a runner that is merely busy may take seconds to answer — a put may probe the guest's agent, and a delete waits out the operation in flight — but one that is unreachable must fail fast, because a single reconcile worker serves every agent in the install and would otherwise spend the whole request timeout on each attempt.
func NewClient(url, token, caPEM string) (*Client, error) {
	c := &Client{URL: url, token: token, HTTP: &http.Client{Timeout: 20 * time.Second}}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 3 * time.Second}).DialContext
	if caPEM != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(caPEM)) {
			return nil, fmt.Errorf("VM runner CA: no certificate in PEM")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}
	c.HTTP.Transport = transport
	return c, nil
}

// UNIT_BOUNDARY_DESCRIPTION: where the client reads the token again when the runner refuses the one it holds — the runner re-reads its token file, so the two can briefly disagree after the Secret changes. A refused call reads it once and retries once; a second refusal, or a token that did not change, is ErrUnauthorized.
func (c *Client) WithTokenReload(reload func(context.Context) (string, error)) *Client {
	c.reload = reload
	return c
}

func (c *Client) Ensure(ctx context.Context, id string, spec MachineSpec) (MachineStatus, error) {
	return c.machine(ctx, c.HTTP, http.MethodPut, id, "", spec)
}

func (c *Client) Status(ctx context.Context, id string) (MachineStatus, error) {
	return c.machine(ctx, c.HTTP, http.MethodGet, id, "", nil)
}

// UNIT_BOUNDARY_DESCRIPTION: the long-poll a watcher makes: the runner answers once the machine's status version is no longer `since`, or once `wait` ends with no change. The call's deadline grows by the wait, so a read that sees no change still gets its answer.
func (c *Client) WaitStatus(ctx context.Context, id string, since uint64, wait time.Duration) (MachineStatus, error) {
	hc := *c.HTTP
	hc.Timeout += wait
	query := url.Values{
		"wait":  {strconv.FormatInt(max(int64(wait/time.Second), 1), 10)},
		"since": {strconv.FormatUint(since, 10)},
	}
	return c.machine(ctx, &hc, http.MethodGet, id, "?"+query.Encode(), nil)
}

func (c *Client) List(ctx context.Context) ([]string, error) {
	raw, err := c.call(ctx, c.HTTP, http.MethodGet, "/machines", nil)
	if err != nil {
		return nil, fmt.Errorf("VM runner: list: %w", err)
	}
	var ids []string
	return ids, json.Unmarshal(raw, &ids)
}

func (c *Client) Delete(ctx context.Context, id string) error {
	_, err := c.machine(ctx, c.HTTP, http.MethodDelete, id, "", nil)
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: removes the home a migration staged for the machine's first boot. The runner answers the same whether there was one or not, so a retry after a lost answer is harmless.
func (c *Client) DeleteSeed(ctx context.Context, id string) error {
	if _, err := c.call(ctx, c.HTTP, http.MethodDelete, "/machines/"+id+"/seed", nil); err != nil {
		return fmt.Errorf("VM runner: delete seed %s: %w", id, err)
	}
	return nil
}

func (c *Client) machine(ctx context.Context, hc *http.Client, method, id, query string, body any) (MachineStatus, error) {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return MachineStatus{}, err
		}
	}
	raw, err := c.call(ctx, hc, method, "/machines/"+id+query, payload)
	if err != nil {
		return MachineStatus{}, fmt.Errorf("VM runner: %s %s: %w", method, id, err)
	}
	var st MachineStatus
	if len(bytes.TrimSpace(raw)) == 0 {
		return st, nil
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return MachineStatus{}, fmt.Errorf("VM runner: decoding status: %w", err)
	}
	return st, nil
}

// UNIT_BOUNDARY_DESCRIPTION: one call, retried once with a re-read token if the runner refuses the one held. The body is kept as bytes so the retry sends it again.
func (c *Client) call(ctx context.Context, hc *http.Client, method, path string, body []byte) ([]byte, error) {
	for retried := false; ; retried = true {
		token := c.currentToken()
		req, err := http.NewRequestWithContext(ctx, method, c.URL+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := hc.Do(req)
		if err != nil {
			return nil, &UnreachableError{cause: err}
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusUnauthorized:
			if retried || !c.refreshToken(ctx, token) {
				return nil, ErrUnauthorized
			}
		case resp.StatusCode >= 300:
			return nil, fmt.Errorf("%s: %s", resp.Status, bytes.TrimSpace(raw))
		default:
			return raw, nil
		}
	}
}

func (c *Client) currentToken() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.token
}

func (c *Client) refreshToken(ctx context.Context, refused string) bool {
	if c.reload == nil {
		return false
	}
	fresh, err := c.reload(ctx)
	if err != nil || fresh == "" || fresh == refused {
		return false
	}
	c.mu.Lock()
	c.token = fresh
	c.mu.Unlock()
	return true
}

// UNIT_BOUNDARY_DESCRIPTION: a runner that could not be reached at all. Its message reaches an Agent's status, which the owner reads, so it says what went wrong in words and never carries the dial error itself, which names the runner's in-cluster host and address. The dial error stays reachable through Unwrap for the controller's own log.
type UnreachableError struct {
	cause error
}

func (e *UnreachableError) Error() string {
	var dns *net.DNSError
	var certErr *tls.CertificateVerificationError
	var unknownAuthority x509.UnknownAuthorityError
	var netErr net.Error
	switch {
	case errors.As(e.cause, &dns):
		return "the VM runner could not be reached: its address does not resolve yet"
	case errors.Is(e.cause, syscall.ECONNREFUSED):
		return "the VM runner could not be reached: it refused the connection"
	case errors.As(e.cause, &certErr), errors.As(e.cause, &unknownAuthority):
		return "the VM runner could not be reached: its TLS certificate is not trusted yet"
	case errors.Is(e.cause, context.DeadlineExceeded), errors.As(e.cause, &netErr) && netErr.Timeout():
		return "the VM runner could not be reached: the connection timed out"
	case errors.Is(e.cause, context.Canceled):
		return "the VM runner could not be reached: the call was cancelled"
	default:
		return "the VM runner could not be reached"
	}
}

func (e *UnreachableError) Unwrap() error {
	return e.cause
}
