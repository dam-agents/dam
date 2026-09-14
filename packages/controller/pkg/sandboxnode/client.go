package sandboxnode

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	URL   string
	Token string
	HTTP  *http.Client
}

func NewClient(url, token, caPEM string) (*Client, error) {
	c := &Client{URL: url, Token: token, HTTP: &http.Client{Timeout: 20 * time.Second}}
	if caPEM != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(caPEM)) {
			return nil, fmt.Errorf("sandbox node CA: no certificate in PEM")
		}
		c.HTTP.Transport = &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	}
	return c, nil
}

func (c *Client) Ensure(ctx context.Context, id string, spec MachineSpec) (MachineStatus, error) {
	return c.do(ctx, http.MethodPut, id, spec)
}

func (c *Client) Status(ctx context.Context, id string) (MachineStatus, error) {
	return c.do(ctx, http.MethodGet, id, nil)
}

func (c *Client) Delete(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodDelete, id, nil)
	return err
}

func (c *Client) do(ctx context.Context, method, id string, body any) (MachineStatus, error) {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return MachineStatus{}, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.URL+"/machines/"+id, &buf)
	if err != nil {
		return MachineStatus{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return MachineStatus{}, fmt.Errorf("sandbox node: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return MachineStatus{}, fmt.Errorf("sandbox node: %s %s: %s: %s", method, id, resp.Status, bytes.TrimSpace(raw))
	}
	var st MachineStatus
	if resp.StatusCode == http.StatusNoContent {
		return st, nil
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return MachineStatus{}, fmt.Errorf("sandbox node: decoding status: %w", err)
	}
	return st, nil
}
