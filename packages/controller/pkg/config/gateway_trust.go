package config

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
)

const systemCABundle = "/etc/ssl/certs/ca-certificates.crt"

// UNIT_BOUNDARY_DESCRIPTION: the CA bundle every agent gateway verifies its upstreams against when the install names CAs beyond the public roots — a TLS-inspecting proxy on the cluster's egress path, or the platform's own gateway when the platform runs inside one of its agents. Envoy takes a single file for its trusted CAs, so the extra CAs are appended to the public roots this process reads from its own image. Each extra must be a certificate that parses, and nothing else may sit between them, because a bundle that silently dropped one would leave every gateway failing upstream with no clue why.
func GatewayUpstreamTrustBundle(basePath, extra string) (string, error) {
	var extras []string
	rest := []byte(extra)
	for {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			return "", fmt.Errorf("holds a %s block; only CERTIFICATE blocks are trusted", block.Type)
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			return "", fmt.Errorf("certificate %d does not parse: %w", len(extras)+1, err)
		}
		extras = append(extras, string(pem.EncodeToMemory(block)))
		rest = next
	}
	if strings.TrimSpace(string(rest)) != "" {
		return "", fmt.Errorf("holds text that is not a PEM certificate after certificate %d", len(extras))
	}
	if len(extras) == 0 {
		return "", fmt.Errorf("holds no PEM certificate")
	}

	base, err := os.ReadFile(basePath)
	if err != nil {
		return "", fmt.Errorf("reading the public roots to extend: %w", err)
	}
	if !strings.Contains(string(base), "-----BEGIN CERTIFICATE-----") {
		return "", fmt.Errorf("the public roots at %s hold no certificate", basePath)
	}
	return strings.TrimRight(string(base), "\n") + "\n" + strings.Join(extras, ""), nil
}
