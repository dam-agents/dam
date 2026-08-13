package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const (
	envoyOwnerLabel            = "agent-platform.ai/owner"
	envoyManagedByLabel        = "agent-platform.ai/managed-by"
	envoySecretTypeLabel       = "agent-platform.ai/secret-type"
	envoyConnectionLabel       = "agent-platform.ai/connection"
	envoyHostPatternAnn        = "agent-platform.ai/host-pattern"
	envoyHeaderNameAnn         = "agent-platform.ai/injection-header-name"
	envoyQueryParamAnn         = "agent-platform.ai/injection-query-param"
	envoyInjectionHTTP2Ann     = "agent-platform.ai/injection-http2"
	envoyInjectionHostsAnn     = "agent-platform.ai/injection-hosts"
	envoyEnvMappingsAnn        = "agent-platform.ai/env-mappings"
	credentialSecretNamePrefix = "platform-cred-"
	envoyBootstrapVolume       = "envoy-bootstrap"
	envoyBootstrapMount        = "/etc/envoy"
	envoyCredentialsRoot       = "/etc/envoy/credentials"
	envoyCredentialKeySDS      = "sds.yaml"
	envoyCredentialSDSName     = "credential"
	envoyLeafTLSVolume         = "envoy-tls"
	envoyLeafTLSMount          = "/etc/envoy/tls"
)

func EnvoyBootstrapName(instanceName string) string {
	return instanceName + "-envoy-bootstrap"
}

type envoyCredential struct {
	SecretName     string
	HeaderName     string
	QueryParamName string
	VolumeName     string
	SDSFileKey     string
}

type envoyHostChain struct {
	ChainID         string
	Host            string
	Credentials     []envoyCredential
	UpstreamCluster string
	HTTP2           bool
	UpstreamPort    int
	Upgrades        bool
	UpstreamCAFile  string
}

func (c envoyHostChain) UpstreamPortValue() int {
	if c.UpstreamPort == 0 {
		return 443
	}
	return c.UpstreamPort
}

func (c envoyHostChain) HostRewrite() string {
	if p := c.UpstreamPortValue(); p != 443 {
		return fmt.Sprintf("%s:%d", c.Host, p)
	}
	return c.Host
}

func (c envoyHostChain) Credentialed() bool { return len(c.Credentials) > 0 }

func (c envoyHostChain) HasQueryParamCredential() bool {
	for _, cred := range c.Credentials {
		if cred.QueryParamName != "" {
			return true
		}
	}
	return false
}

const envoySecretTypeAllowOnly = "allow-only"

func listAgentCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string, grantedSecretIDs, grantedConnectionIDs []string) ([]corev1.Secret, error) {
	all, err := listOwnerCredentialSecrets(ctx, client, namespace, owner)
	if err != nil {
		return nil, err
	}
	return filterByGrants(all, grantedSecretIDs, grantedConnectionIDs), nil
}

func filterByGrants(secrets []corev1.Secret, grantedSecretIDs, grantedConnectionIDs []string) []corev1.Secret {
	grantedSecretIds := toGrantSet(grantedSecretIDs)
	grantedConnIds := toGrantSet(grantedConnectionIDs)

	resolvedSecrets := map[string]bool{}
	resolvedConns := map[string]bool{}

	out := secrets[:0:0]
	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case envoySecretTypeAllowOnly:
			out = append(out, s)
		case "connection":
			connKey := s.Labels[envoyConnectionLabel]
			if grantedConnIds[connKey] {
				resolvedConns[connKey] = true
				out = append(out, s)
			}
		default:
			id := strings.TrimPrefix(s.Name, credentialSecretNamePrefix)
			if grantedSecretIds[id] {
				resolvedSecrets[id] = true
				out = append(out, s)
			}
		}
	}

	if unresolved := unresolvedKeys(grantedSecretIds, resolvedSecrets); len(unresolved) > 0 {
		slog.Warn("granted-secret-ids contains ids with no matching owner Secret; entries contribute nothing",
			"unresolvedIds", unresolved)
	}
	if unresolved := unresolvedKeys(grantedConnIds, resolvedConns); len(unresolved) > 0 {
		slog.Warn("granted-connection-ids contains ids with no matching owner Secret; entries contribute nothing",
			"unresolvedIds", unresolved)
	}

	return out
}

func unresolvedKeys(granted, resolved map[string]bool) []string {
	var missing []string
	for id := range granted {
		if !resolved[id] {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	return missing
}

func toGrantSet(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		if p := strings.TrimSpace(id); p != "" {
			out[p] = true
		}
	}
	return out
}

func listOwnerCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string) ([]corev1.Secret, error) {
	if owner == "" {
		return nil, nil
	}
	selector := fmt.Sprintf("%s=%s,%s=api-server", envoyOwnerLabel, owner, envoyManagedByLabel)
	list, err := client.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("listing owner credential secrets: %w", err)
	}
	items := append([]corev1.Secret(nil), list.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

type envMapping struct {
	EnvName     string `json:"envName"`
	Placeholder string `json:"placeholder"`
}

func credentialEnvVars(secrets []corev1.Secret) []corev1.EnvVar {
	const fallbackPlaceholder = "dummy-placeholder"
	seen := map[string]struct{}{}
	add := func(envs []corev1.EnvVar, name, value string) []corev1.EnvVar {
		if name == "" {
			return envs
		}
		if _, dup := seen[name]; dup {
			return envs
		}
		if value == "" {
			value = fallbackPlaceholder
		}
		seen[name] = struct{}{}
		return append(envs, corev1.EnvVar{Name: name, Value: value})
	}
	var envs []corev1.EnvVar
	for _, s := range secrets {
		raw := s.Annotations[envoyEnvMappingsAnn]
		if raw == "" {
			continue
		}
		var mappings []envMapping
		if err := json.Unmarshal([]byte(raw), &mappings); err != nil {
			slog.Warn("invalid env-mappings annotation; skipping",
				"namespace", s.Namespace, "secret", s.Name, "error", err)
			continue
		}
		for _, m := range mappings {
			envs = add(envs, m.EnvName, m.Placeholder)
		}
	}
	return envs
}

type connectionHostInjection struct {
	Host           string `json:"host"`
	PathPattern    string `json:"pathPattern,omitempty"`
	HeaderName     string `json:"headerName,omitempty"`
	ValueFormat    string `json:"valueFormat,omitempty"`
	Encoding       string `json:"encoding,omitempty"`
	QueryParamName string `json:"queryParamName,omitempty"`
	HTTP2          bool   `json:"http2,omitempty"`
	Port           int    `json:"port,omitempty"`
	Upgrades       bool   `json:"upgrades,omitempty"`
	CAKey          string `json:"caKey,omitempty"`
	SDSKey         string `json:"sdsKey,omitempty"`
}

func sdsFileKeyForHost(host string) string {
	return "host-" + base64.RawURLEncoding.EncodeToString([]byte(host)) + ".sds.yaml"
}

func sdsFileKey(e connectionHostInjection) string {
	if e.SDSKey != "" {
		return e.SDSKey
	}
	return sdsFileKeyForHost(e.Host)
}

type hostCredential struct {
	host string
	opts chainOpts
	cred envoyCredential
}

type chainOpts struct {
	http2    bool
	port     int
	upgrades bool
	caFile   string
}

func expandConnectionSecret(s corev1.Secret) []hostCredential {
	entries := parseConnectionHosts(s)
	if len(entries) == 0 {
		return nil
	}
	seen := map[struct{ host, header string }]struct{}{}
	out := make([]hostCredential, 0, len(entries))
	for _, e := range entries {
		if e.Host == "" {
			continue
		}
		header := e.HeaderName
		if header == "" {
			header = "Authorization"
		}
		key := struct{ host, header string }{e.Host, header}
		if _, dup := seen[key]; dup {
			slog.Warn("duplicate (host, header) in injection-hosts; skipping later entry",
				"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "headerName", header)
			continue
		}
		seen[key] = struct{}{}
		caFile := ""
		if e.CAKey != "" {
			switch {
			case strings.ContainsAny(e.CAKey, "/\\") || strings.Contains(e.CAKey, ".."):
				slog.Warn("invalid caKey in injection-hosts; ignoring",
					"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "caKey", e.CAKey)
			case len(s.Data[e.CAKey]) == 0:
				slog.Warn("connection Secret missing CA data key; validating host against system trust instead",
					"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "caKey", e.CAKey)
			default:
				caFile = envoyCredentialsRoot + "/cred-" + s.Name + "/" + e.CAKey
			}
		}
		out = append(out, hostCredential{
			host: e.Host,
			opts: chainOpts{
				http2:    e.HTTP2,
				port:     e.Port,
				upgrades: e.Upgrades,
				caFile:   caFile,
			},
			cred: envoyCredential{
				SecretName:     s.Name,
				HeaderName:     header,
				QueryParamName: e.QueryParamName,
				VolumeName:     "cred-" + s.Name,
				SDSFileKey:     sdsFileKey(e),
			},
		})
	}
	return out
}

func parseConnectionHosts(s corev1.Secret) []connectionHostInjection {
	raw := s.Annotations[envoyInjectionHostsAnn]
	if raw == "" {
		return nil
	}
	var entries []connectionHostInjection
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		slog.Warn("malformed injection-hosts annotation; skipping",
			"namespace", s.Namespace, "secret", s.Name, "error", err)
		return nil
	}
	return entries
}

func chainsFromSecrets(secrets []corev1.Secret, l7Hosts []string) []envoyHostChain {
	type bucket struct {
		host        string
		seenHeader  map[string]string
		credentials []envoyCredential
		opts        chainOpts
		first       string
	}
	byHost := map[string]*bucket{}
	order := []string{}

	add := func(host, secretName string, cred *envoyCredential, opts chainOpts) {
		if host == "" {
			return
		}
		b := byHost[host]
		if b == nil {
			b = &bucket{host: host, seenHeader: map[string]string{}, first: secretName}
			byHost[host] = b
			order = append(order, host)
		}
		if opts.http2 {
			b.opts.http2 = true
		}
		if opts.upgrades {
			b.opts.upgrades = true
		}
		if opts.port != 0 {
			if b.opts.port == 0 {
				b.opts.port = opts.port
			} else if b.opts.port != opts.port {
				slog.Warn("conflicting upstream ports on host; keeping first",
					"host", host, "keptPort", b.opts.port,
					"skippedPort", opts.port, "skippedSecret", secretName)
			}
		}
		if opts.caFile != "" {
			if b.opts.caFile == "" {
				b.opts.caFile = opts.caFile
			} else if b.opts.caFile != opts.caFile {
				slog.Warn("conflicting upstream CA files on host; keeping first",
					"host", host, "keptCA", b.opts.caFile,
					"skippedCA", opts.caFile, "skippedSecret", secretName)
			}
		}
		if cred == nil {
			return
		}
		header := cred.HeaderName
		if header == "" {
			header = "Authorization"
		}
		if winner, dup := b.seenHeader[header]; dup {
			slog.Warn("duplicate injection header on host; later credential skipped to avoid credential_injector clobber",
				"host", host, "headerName", header,
				"winningSecret", winner, "skippedSecret", secretName)
			return
		}
		b.seenHeader[header] = secretName
		c := *cred
		c.HeaderName = header
		b.credentials = append(b.credentials, c)
	}

	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case "connection":
			for _, hc := range expandConnectionSecret(s) {
				cred := hc.cred
				if len(s.Data[cred.SDSFileKey]) == 0 {
					slog.Warn("connection Secret missing SDS data key; rendering host allow-only (no credential injection)",
						"namespace", s.Namespace, "secret", s.Name, "host", hc.host, "sdsKey", cred.SDSFileKey)
					add(hc.host, s.Name, nil, hc.opts)
					continue
				}
				add(hc.host, s.Name, &cred, hc.opts)
			}
		case envoySecretTypeAllowOnly:
			add(s.Annotations[envoyHostPatternAnn], s.Name, nil,
				chainOpts{http2: s.Annotations[envoyInjectionHTTP2Ann] == "true"})
		}
	}

	for _, host := range l7Hosts {
		add(host, "l7", nil, chainOpts{})
	}

	chains := make([]envoyHostChain, 0, len(order))
	for _, host := range order {
		b := byHost[host]
		chains = append(chains, envoyHostChain{
			ChainID:         "chain_" + b.first + "_" + hostShort(host),
			UpstreamCluster: "upstream_" + b.first + "_" + hostShort(host),
			Host:            host,
			Credentials:     b.credentials,
			HTTP2:           b.opts.http2,
			UpstreamPort:    b.opts.port,
			Upgrades:        b.opts.upgrades,
			UpstreamCAFile:  b.opts.caFile,
		})
	}
	return chains
}

func hostShort(host string) string {
	h := sha256.Sum256([]byte(host))
	return hex.EncodeToString(h[:])[:8]
}

func hostInChains(chains []envoyHostChain, host string) bool {
	if host == "" {
		return false
	}
	for _, c := range chains {
		if c.Host == host {
			return true
		}
	}
	return false
}

const platformGatewayHealthPath = "/__platform_healthz"

const envoyListenAddress = "0.0.0.0"

const gatewayOTelServiceName = "platform-agent-gateway"

type envoyOTelView struct {
	Traces          bool
	AccessLogs      bool
	Metrics         bool
	Collector       bool
	Secure          bool
	GRPC            bool
	SamplingPercent float64
	ServiceName     string
	AgentID         string
	CollectorHost   string
	CollectorPort   int
	TracesURI       string
	LogsURI         string
}

func newEnvoyOTelView(instanceName string, cfg *config.Config) envoyOTelView {
	exp, ok := cfg.OTelExporter()
	if !ok {
		return envoyOTelView{}
	}
	v := envoyOTelView{
		Traces:          true,
		AccessLogs:      true,
		Metrics:         exp.GRPC,
		Collector:       true,
		Secure:          exp.Secure,
		GRPC:            exp.GRPC,
		SamplingPercent: cfg.TraceSamplingPercent(),
		ServiceName:     gatewayOTelServiceName,
		AgentID:         instanceName,
		CollectorHost:   exp.Host,
		CollectorPort:   exp.Port,
	}
	if !exp.GRPC {
		scheme := "http"
		if exp.Secure {
			scheme = "https"
		}
		v.TracesURI = fmt.Sprintf("%s://%s:%d/v1/traces", scheme, exp.Host, exp.Port)
		v.LogsURI = fmt.Sprintf("%s://%s:%d/v1/logs", scheme, exp.Host, exp.Port)
	}
	return v
}

func BuildEnvoyBootstrapConfigMap(instanceName, attributionID string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret, l7Hosts []string) (*corev1.ConfigMap, error) {
	chains := chainsFromSecrets(secrets, l7Hosts)
	yaml, err := renderEnvoyBootstrap(instanceName, attributionID, cfg, chains)
	if err != nil {
		return nil, err
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            EnvoyBootstrapName(instanceName),
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: instanceName},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Data: map[string]string{"envoy.yaml": yaml},
	}, nil
}

func envoyVolumes(instanceName string, cfg *config.Config, secrets []corev1.Secret, l7Hosts []string) []corev1.Volume {
	volumes := []corev1.Volume{{
		Name: envoyBootstrapVolume,
		VolumeSource: corev1.VolumeSource{
			ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: EnvoyBootstrapName(instanceName)},
			},
		},
	}}
	for _, s := range secrets {
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			continue
		}
		volumes = append(volumes, corev1.Volume{
			Name: "cred-" + s.Name,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{SecretName: s.Name},
			},
		})
	}
	if len(secrets) > 0 || len(l7Hosts) > 0 || cfg.TelemetryEnabled() {
		volumes = append(volumes, corev1.Volume{
			Name: envoyLeafTLSVolume,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(instanceName),
					Optional:   ptrBool(false),
				},
			},
		})
	}
	return volumes
}

func ptrBool(b bool) *bool { return &b }

const envoyBootstrapTemplateRev = "v15-structured-config"

func envoySecretsRev(secrets []corev1.Secret, l7Hosts []string) string {
	parts := []string{"tmpl=" + envoyBootstrapTemplateRev}
	for _, h := range l7Hosts {
		parts = append(parts, "l7|"+h)
	}
	for _, s := range secrets {
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s",
			s.Name,
			s.Annotations[envoyHostPatternAnn],
			s.Labels[envoySecretTypeLabel],
			s.Annotations[envoyHeaderNameAnn],
			s.Annotations[envoyQueryParamAnn],
			s.Annotations[envoyInjectionHostsAnn],
			strings.Join(sdsDataKeys(s), ","),
		))
	}
	sort.Strings(parts[1:])
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:8])
}

func sdsDataKeys(s corev1.Secret) []string {
	var keys []string
	for k := range s.Data {
		if k == envoyCredentialKeySDS || strings.HasSuffix(k, ".sds.yaml") {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

func envoyContainer(instanceName string, cfg *config.Config, secrets []corev1.Secret, l7Hosts []string) corev1.Container {
	mounts := []corev1.VolumeMount{{
		Name:      envoyBootstrapVolume,
		MountPath: envoyBootstrapMount,
		ReadOnly:  true,
	}}
	for _, s := range secrets {
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			continue
		}
		mounts = append(mounts, corev1.VolumeMount{
			Name:      "cred-" + s.Name,
			MountPath: envoyCredentialsRoot + "/cred-" + s.Name,
			ReadOnly:  true,
		})
	}
	if len(secrets) > 0 || len(l7Hosts) > 0 || cfg.TelemetryEnabled() {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      envoyLeafTLSVolume,
			MountPath: envoyLeafTLSMount,
			ReadOnly:  true,
		})
	}
	c := corev1.Container{
		Name:            "envoy",
		Image:           cfg.EnvoyImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Args: []string{
			"--config-path", envoyBootstrapMount + "/envoy.yaml",
			"--log-level", "info",
		},
		VolumeMounts: mounts,
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("50m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities:           &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			ReadOnlyRootFilesystem: ptrBool(true),
			RunAsNonRoot:           ptrBool(true),
		},
	}
	c.Env = gatewayOTelEnv(instanceName, cfg)
	return c
}

func gatewayOTelEnv(instanceName string, cfg *config.Config) []corev1.EnvVar {
	if !cfg.OTelEnabled() {
		return nil
	}
	effective := map[string]string{}
	if cfg.GatewayOTLPEndpoint != "" {
		effective["OTEL_EXPORTER_OTLP_ENDPOINT"] = cfg.GatewayOTLPEndpoint
		proto := cfg.GatewayOTLPProtocol
		if proto == "" {
			proto = "grpc"
		}
		effective["OTEL_EXPORTER_OTLP_PROTOCOL"] = proto
	}
	keys := make([]string, 0, len(cfg.OTelEnv)+len(effective))
	for k := range cfg.OTelEnv {
		if k == "OTEL_RESOURCE_ATTRIBUTES" || k == "OTEL_SERVICE_NAME" {
			continue
		}
		if strings.HasSuffix(k, "HEADERS") {
			continue
		}
		if _, ok := effective[k]; ok {
			continue
		}
		keys = append(keys, k)
	}
	for k := range effective {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	env := make([]corev1.EnvVar, 0, len(keys)+1)
	for _, k := range keys {
		v, ok := effective[k]
		if !ok {
			v = cfg.OTelEnv[k]
		}
		env = append(env, corev1.EnvVar{Name: k, Value: v})
	}
	env = append(env, corev1.EnvVar{
		Name:  "OTEL_RESOURCE_ATTRIBUTES",
		Value: fmt.Sprintf("platform.gateway.id=%s,k8s.namespace.name=%s", instanceName, cfg.Namespace),
	})
	return env
}
