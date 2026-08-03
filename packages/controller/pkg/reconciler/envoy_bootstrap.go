package reconciler

import (
	"fmt"
	"strconv"

	sigsyaml "sigs.k8s.io/yaml"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Envoy bootstrap document assembly.
//
// The gateway's proxy configuration used to be produced by string-templating a
// large YAML document, splicing user- and connection-derived values (hostnames,
// header names, query-param names, Secret-derived identifiers) into it raw. A
// crafted value could break out of its YAML position and inject arbitrary proxy
// configuration (#2899). Field-level input validation (#2865/#2870) mitigated
// that per-field, but the template itself stayed an unescaped-interpolation
// footgun for whoever added the next field.
//
// This file assembles the whole document as structured Go data
// (`map[string]any` / `[]any`) and serializes it with a real YAML encoder, so
// every string value is quoted and escaped by construction. There is no
// interpolation path left for a value to escape its position — the encoder owns
// quoting for every field, present and future, with no per-field discipline.
// Envoy accepts the encoder's output (YAML is a superset of the JSON the
// encoder emits) exactly as it accepted the old template's output.

// ev is a terse alias for an Envoy config mapping node; sequences use a plain
// []any. Keeping the name short keeps the deeply-nested literals below readable.
type ev = map[string]any

// bootstrapParams is the fully-resolved input to the bootstrap builder. It
// mirrors the values the reconciler already computes; nothing here is derived
// from raw agent input without having passed through the same resolution the
// template consumed.
type bootstrapParams struct {
	ListenAddress          string
	Port                   int
	Chains                 []envoyHostChain
	CredentialsRoot        string
	CredentialSDSName      string
	LeafTLSDir             string
	HarnessAuthority       string
	HarnessHost            string
	HarnessPort            int
	ObjectStoreAuthority   string
	ObjectStoreHost        string
	ObjectStorePort        int
	HealthPath             string
	ExtAuthzHost           string
	ExtAuthzPort           int
	ExtAuthzTimeoutSeconds int
	Telemetry              bool
	TelemetryCollectorHost string
	TelemetryCollectorPort int
	InstanceID             string
	// AttributionID is the id stamped into the trusted `x-platform-agent-id`
	// telemetry header. It defaults to InstanceID (the gateway attributes to
	// its own instance); the api-server sets an override for Invocation targets
	// so their spend credits the root Driver. When it differs from InstanceID,
	// the collector chain additionally stamps `x-platform-invocation-id` with
	// InstanceID so the merged child row stays distinguishable (#3041).
	AttributionID string
	AnyUpgrades   bool
	OTel          envoyOTelView
}

// attributionOverridden reports whether a telemetry attribution override is in
// effect — i.e. the trusted `x-platform-agent-id` stamp is some other agent's
// id, not this gateway's own instance.
func (p bootstrapParams) attributionOverridden() bool {
	return p.AttributionID != "" && p.AttributionID != p.InstanceID
}

// renderEnvoyBootstrap returns the Envoy bootstrap YAML for an instance's
// paired gateway pod.
//
// `instanceID` is this gateway's own instance (the agent name); it is emitted
// as the bounded `platform.gateway.id` attribute on the gateway's own
// telemetry, names the per-instance ext-authz Service the gateway dials, and —
// absent an attribution override — is the value stamped into the trusted
// `x-platform-agent-id` telemetry header.
// `attributionID` overrides the trusted `x-platform-agent-id` stamp: empty
// means stamp `instanceID` (own-instance attribution); non-empty means stamp
// that id instead and additionally stamp `x-platform-invocation-id` with
// `instanceID`, so an Invocation target's spend credits its root Driver while
// the child row stays distinguishable (#3041).
func renderEnvoyBootstrap(instanceID, attributionID string, cfg *config.Config, chains []envoyHostChain) (string, error) {
	// Envoy's per-call timeout sits ahead of the application-level hold so a
	// hold-window timeout fires from the api-server side, not from Envoy.
	extAuthzTimeoutSeconds := cfg.ExtAuthzHoldSeconds + 60
	// :authority value the harness Service is reached on. The agent
	// builds harness URLs from cfg.HarnessServerURL (`<rel>-apiserver-harness`),
	// so the Host/:authority includes the port. We match on
	// this exact string so the harness route is scoped to api-server
	// traffic only — fall-through goes through the regular egress paths.
	harnessAuthority := fmt.Sprintf("%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)
	// Empty (no bundled store) renders no store routes or cluster.
	objectStoreAuthority := ""
	if cfg.ObjectStoreHost != "" {
		objectStoreAuthority = fmt.Sprintf("%s:%d", cfg.ObjectStoreHost, cfg.ObjectStorePort)
	}
	// Render the telemetry collector chain only when the backend is configured
	// AND the collector host doesn't collide with a credentialed chain host —
	// two filter chains sharing `server_names` is a fatal Envoy config error.
	// A collision isn't expected in practice (the collector host is an internal
	// Service DNS no agent would be granted a credential for), but guard
	// structurally rather than crash-loop the gateway. The credentialed chain
	// for that host still wins, and the host is in the leaf SAN regardless.
	telemetry := cfg.TelemetryEnabled() && !hostInChains(chains, cfg.TelemetryCollectorHost)
	anyUpgrades := false
	for _, c := range chains {
		if c.Upgrades {
			anyUpgrades = true
			break
		}
	}
	p := bootstrapParams{
		ListenAddress:          envoyListenAddress,
		Port:                   cfg.EnvoyPort,
		Chains:                 chains,
		CredentialsRoot:        envoyCredentialsRoot,
		CredentialSDSName:      envoyCredentialSDSName,
		LeafTLSDir:             envoyLeafTLSMount,
		HarnessAuthority:       harnessAuthority,
		HarnessHost:            cfg.HarnessHost(),
		HarnessPort:            cfg.HarnessServerPort,
		ObjectStoreAuthority:   objectStoreAuthority,
		ObjectStoreHost:        cfg.ObjectStoreHost,
		ObjectStorePort:        cfg.ObjectStorePort,
		HealthPath:             platformGatewayHealthPath,
		ExtAuthzHost:           cfg.ExtAuthzHostFor(instanceID),
		ExtAuthzPort:           cfg.ExtAuthzPort,
		ExtAuthzTimeoutSeconds: extAuthzTimeoutSeconds,
		Telemetry:              telemetry,
		TelemetryCollectorHost: cfg.TelemetryCollectorHost,
		TelemetryCollectorPort: cfg.TelemetryCollectorPort,
		InstanceID:             instanceID,
		AttributionID:          attributionID,
		AnyUpgrades:            anyUpgrades,
		OTel:                   newEnvoyOTelView(instanceID, cfg),
	}
	doc := buildEnvoyBootstrap(p)
	out, err := sigsyaml.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("marshaling envoy bootstrap: %w", err)
	}
	return string(out), nil
}

// buildEnvoyBootstrap assembles the whole bootstrap document as structured
// data. Topology (unchanged from the original template):
//
//  1. The agent points HTTP(S)_PROXY at the paired gateway pod's Service DNS.
//     The OUTER listener terminates the agent's CONNECT and routes the inner
//     stream into the INTERNAL listener.
//  2. The INTERNAL listener uses tls_inspector to read SNI. One filter chain
//     per known host terminates TLS with that host's leaf cert; the default
//     chain (SNI miss) does TCP passthrough via sni_dynamic_forward_proxy.
//  3. Inside a TLS-terminating chain, an HCM runs credential_injector and
//     forwards to a per-credential STRICT_DNS cluster pinned to the
//     credential's host. The agent's inner Host header has no influence on
//     routing, so the route-confusion exfiltration path is structurally
//     closed. Allow-only chains keep dynamic_forward_proxy_https.
func buildEnvoyBootstrap(p bootstrapParams) ev {
	doc := ev{
		"node": ev{
			"id":      "platform-credential-injector",
			"cluster": "platform-credential-injector",
		},
		"bootstrap_extensions": []any{
			ev{
				"name":         "envoy.bootstrap.internal_listener",
				"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener"},
			},
		},
		"static_resources": ev{
			"listeners": []any{
				buildOuterListener(p),
				buildInternalListener(p),
			},
			"clusters": buildClusters(p),
		},
	}
	if p.OTel.Metrics {
		// Push Envoy's stats over OTLP/gRPC to the collector. No admin
		// interface is enabled, so this is the only stats egress.
		doc["stats_sinks"] = []any{
			ev{
				"name": "envoy.stat_sinks.open_telemetry",
				"typed_config": ev{
					"@type":        "type.googleapis.com/envoy.extensions.stat_sinks.open_telemetry.v3.SinkConfig",
					"grpc_service": otlpGRPCService(),
				},
			},
		}
	}
	return doc
}

// --- outer listener (CONNECT terminator) ---

func buildOuterListener(p bootstrapParams) ev {
	hcm := ev{
		"@type":       "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix": "agent_egress",
		"upgrade_configs": []any{
			ev{"upgrade_type": "CONNECT"},
			// dam-run opens a WebSocket to the harness /run endpoint.
			ev{"upgrade_type": "websocket"},
		},
		"http_filters": []any{
			// np-gate liveness probe (#675): answered locally before ext_authz.
			ev{
				"name": "envoy.filters.http.health_check",
				"typed_config": ev{
					"@type":             "type.googleapis.com/envoy.extensions.filters.http.health_check.v3.HealthCheck",
					"pass_through_mode": false,
					"headers":           []any{ev{"name": ":path", "string_match": ev{"exact": p.HealthPath}}},
				},
			},
			// Gate plain-HTTP egress; the CONNECT route disables this per-route.
			extAuthzHTTPFilter(p),
			dynamicForwardProxyHTTPFilter(),
			routerHTTPFilter(),
		},
		"route_config": ev{
			"name": "connect_routes",
			"virtual_hosts": []any{
				ev{
					"name":    "connect",
					"domains": []any{"*"},
					"routes":  buildOuterRoutes(p),
				},
			},
		},
	}
	if p.OTel.Traces {
		// Scoped to this outer listener so spans see CONNECT (method +
		// host:port, never a path/query) and plain-HTTP egress — credential
		// injection happens downstream, so no injected secret reaches a span
		// tag here. traceparent is stripped on the external-egress route.
		hcm["tracing"] = otelTracing(p, 256)
	}
	if p.OTel.AccessLogs {
		hcm["access_log"] = hcmAccessLog(p, "", "agent_egress", "egress")
	}
	return ev{
		"name":    "agent_egress",
		"address": ev{"socket_address": ev{"address": p.ListenAddress, "port_value": p.Port}},
		"filter_chains": []any{
			ev{"filters": []any{ev{"name": "envoy.filters.network.http_connection_manager", "typed_config": hcm}}},
		},
	}
}

func buildOuterRoutes(p bootstrapParams) []any {
	connectUpgrade := []any{ev{"upgrade_type": "CONNECT", "connect_config": ev{}}}
	routes := []any{
		// Harness CONNECT: splice raw TCP to a pinned upstream. ext_authz is
		// disabled — harness traffic is control-plane, not user egress.
		ev{
			"match": ev{
				"connect_matcher": ev{},
				"headers":         []any{ev{"name": ":authority", "string_match": ev{"exact": p.HarnessAuthority}}},
			},
			"route":                   ev{"cluster": "harness_passthrough", "upgrade_configs": connectUpgrade},
			"typed_per_filter_config": extAuthzDisabledPerRoute(),
		},
	}
	if p.ObjectStoreAuthority != "" {
		// Object-store CONNECT (presigned candidate uploads). Policy stays with
		// ext_authz, which fires here (unlike the harness routes).
		routes = append(routes, ev{
			"match": ev{
				"connect_matcher": ev{},
				"headers":         []any{ev{"name": ":authority", "string_match": ev{"exact": p.ObjectStoreAuthority}}},
			},
			"route": ev{"cluster": "objectstore_passthrough", "upgrade_configs": connectUpgrade},
		})
	}
	if p.Telemetry && p.OTel.Traces {
		// Agent-telemetry export CONNECT: same tunnel as the generic CONNECT
		// below but with tracing sampled to zero so the pipeline doesn't
		// observe itself. The access log still records the tunnel.
		routes = append(routes, ev{
			"match": ev{
				"connect_matcher": ev{},
				"headers":         []any{ev{"name": ":authority", "string_match": ev{"exact": fmt.Sprintf("%s:%d", p.TelemetryCollectorHost, p.TelemetryCollectorPort)}}},
			},
			"route":                   ev{"cluster": "tls_inspect_internal", "upgrade_configs": connectUpgrade},
			"tracing":                 ev{"random_sampling": ev{"numerator": 0}, "overall_sampling": ev{"numerator": 0}},
			"typed_per_filter_config": extAuthzDisabledPerRoute(),
		})
	}
	// Generic CONNECT into the TLS-intercept internal listener.
	genericRoute := ev{"cluster": "tls_inspect_internal", "upgrade_configs": connectUpgrade}
	if p.AnyUpgrades {
		// Outer tunnel carries the inner streaming bytes, so its idle timeout
		// must match or the default 5-min timer cuts a quiet port-forward first.
		genericRoute["idle_timeout"] = "14400s"
	}
	routes = append(routes, ev{
		"match":                   ev{"connect_matcher": ev{}},
		"route":                   genericRoute,
		"typed_per_filter_config": extAuthzDisabledPerRoute(),
	})
	// Platform-internal harness traffic (absolute-URI). ext_authz disabled.
	routes = append(routes, ev{
		"match": ev{
			"prefix":  "/",
			"headers": []any{ev{"name": ":authority", "string_match": ev{"exact": p.HarnessAuthority}}},
		},
		"route":                   ev{"cluster": "dynamic_forward_proxy_http", "timeout": "0s"},
		"typed_per_filter_config": extAuthzDisabledPerRoute(),
	})
	// Plain HTTP fallthrough. The outer HCM's ext_authz fires here; forward
	// plaintext via dynamic_forward_proxy_http (no MITM needed).
	fallthroughRoute := ev{
		"match": ev{"prefix": "/"},
		"route": ev{"cluster": "dynamic_forward_proxy_http", "timeout": "0s"},
	}
	if p.OTel.Traces {
		// Strip internal trace context before it reaches an external upstream.
		fallthroughRoute["request_headers_to_remove"] = []any{"traceparent", "tracestate"}
	}
	routes = append(routes, fallthroughRoute)
	return routes
}

// --- internal listener (TLS-terminating, SNI-matched) ---

func buildInternalListener(p bootstrapParams) ev {
	chains := make([]any, 0, len(p.Chains)+2)
	for _, c := range p.Chains {
		chains = append(chains, buildTerminatingChain(p, c))
	}
	if p.Telemetry {
		chains = append(chains, buildCollectorChain(p))
	}
	chains = append(chains, buildL4CatchAllChain(p))
	return ev{
		"name":              "tls_inspect_internal",
		"internal_listener": ev{},
		"listener_filters": []any{
			ev{
				"name":         "envoy.filters.listener.tls_inspector",
				"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector"},
			},
		},
		"filter_chains": chains,
	}
}

func buildTerminatingChain(p bootstrapParams, c envoyHostChain) ev {
	commonTLS := ev{
		"tls_certificates": []any{
			ev{
				"certificate_chain": ev{"filename": p.LeafTLSDir + "/tls.crt"},
				"private_key":       ev{"filename": p.LeafTLSDir + "/tls.key"},
			},
		},
	}
	if c.HTTP2 {
		// gRPC chain: offer h2 so the agent's grpclib client negotiates HTTP/2
		// over the MITM cert. REST chains omit ALPN and stay h1.
		commonTLS["alpn_protocols"] = []any{"h2", "http/1.1"}
	}

	hcm := ev{
		"@type":        "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix":  "terminate_" + c.ChainID,
		"http_filters": buildChainHTTPFilters(p, c),
		"route_config": ev{
			"name": "forward_" + c.ChainID,
			"virtual_hosts": []any{
				ev{"name": "default", "domains": []any{"*"}, "routes": []any{buildChainForwardRoute(c)}},
			},
		},
	}
	if c.Upgrades {
		// kubectl exec/port-forward/logs -f; spdy/3.1 is the legacy client-go
		// fallback. Injection covered the upgrade request.
		hcm["upgrade_configs"] = []any{ev{"upgrade_type": "websocket"}, ev{"upgrade_type": "spdy/3.1"}}
	}
	if p.OTel.Traces && !c.HasQueryParamCredential() {
		// Traced: this chain sees the agent's decrypted traceparent, so its
		// span joins the harness trace. Safe only because every credential
		// here is header-injected and span tags never record headers;
		// query-param chains stay untraced. max_path_tag_length 1 keeps the
		// agent-authored path/query out of the http.url tag.
		hcm["tracing"] = otelTracing(p, 1)
	}
	if p.OTel.AccessLogs {
		hcm["access_log"] = hcmAccessLog(p, "terminate_"+c.ChainID, "terminate_"+c.ChainID, "chains")
	}

	return ev{
		"name":               "terminate_" + c.ChainID,
		"filter_chain_match": ev{"server_names": []any{c.Host}},
		"transport_socket": ev{
			"name": "envoy.transport_sockets.tls",
			"typed_config": ev{
				"@type":              "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
				"common_tls_context": commonTLS,
			},
		},
		"filters": []any{ev{"name": "envoy.filters.network.http_connection_manager", "typed_config": hcm}},
	}
}

// buildChainHTTPFilters returns the ordered HTTP filter list for a terminating
// chain: HITL ext_authz first, then one credential_injector (plus a Lua
// query-param mover where configured) per credential, then dynamic_forward_
// proxy and router.
func buildChainHTTPFilters(p bootstrapParams, c envoyHostChain) []any {
	filters := []any{extAuthzHTTPFilter(p)}
	for _, cred := range c.Credentials {
		filters = append(filters, ev{
			"name": "envoy.filters.http.credential_injector",
			"typed_config": ev{
				"@type":     "type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector",
				"overwrite": true,
				"credential": ev{
					"name": "envoy.http.injected_credentials.generic",
					"typed_config": ev{
						"@type": "type.googleapis.com/envoy.extensions.http.injected_credentials.generic.v3.Generic",
						"credential": ev{
							"name": p.CredentialSDSName,
							"sds_config": ev{
								"path_config_source": ev{
									"path": p.CredentialsRoot + "/" + cred.VolumeName + "/" + cred.SDSFileKey,
									// Watch the Secret-volume mount root, not the
									// sds.yaml path: kubelet rotates the ..data
									// symlink inside the mount, and Envoy's
									// default path-only inotify never fires on it.
									"watched_directory": ev{"path": p.CredentialsRoot + "/" + cred.VolumeName},
								},
							},
						},
						"header": cred.HeaderName,
					},
				},
			},
		})
		if cred.QueryParamName != "" {
			// credential_injector wrote the SDS value into the header; this
			// Lua filter moves it into the URL query parameter and strips the
			// header so it never reaches the upstream. The path is parsed
			// manually (no Lua-pattern gsub) so credential bytes can't be
			// interpreted as Lua replacement backreferences.
			filters = append(filters, ev{
				"name": "envoy.filters.http.lua",
				"typed_config": ev{
					"@type":               "type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua",
					"default_source_code": ev{"inline_string": luaQueryParamScript(cred.HeaderName, cred.QueryParamName)},
				},
			})
		}
	}
	filters = append(filters, dynamicForwardProxyHTTPFilter(), routerHTTPFilter())
	return filters
}

func buildChainForwardRoute(c envoyHostChain) ev {
	route := ev{"timeout": "0s"}
	if c.Credentialed() {
		// Pinned to a per-chain static cluster; the agent's Host header cannot
		// steer this request elsewhere. host_rewrite_literal canonicalises the
		// upstream Host so honest backends never see an agent-manipulated value.
		route["cluster"] = c.UpstreamCluster
		route["host_rewrite_literal"] = c.HostRewrite()
	} else {
		// Allow-only (path-rule promoted, no credential injection). No
		// credential to misroute, so dynamic_forward_proxy_https is fine.
		route["cluster"] = "dynamic_forward_proxy_https"
	}
	if c.Upgrades {
		route["idle_timeout"] = "14400s"
	}
	return ev{"match": ev{"prefix": "/"}, "route": route}
}

// buildCollectorChain is the telemetry-egress chain: the agent exports OTLP/
// HTTP to the collector through this gateway; we MITM-terminate on the
// collector SNI and stamp the trusted x-platform-agent-id header, OVERWRITING
// anything the agent set. No ext_authz (platform-internal) and no credential
// injection.
//
// The stamped attribution id is p.AttributionID when an override is in effect
// (an Invocation target crediting its root Driver), else this gateway's own
// p.InstanceID. When overriding, we additionally stamp x-platform-invocation-id
// with the own id so the merged child row stays distinguishable; when NOT
// overriding, we strip any agent-supplied x-platform-invocation-id, since that
// header is only sometimes added and an agent must not be able to smuggle a
// forged one past the gateway (the agent-id header is always overwritten, so it
// needs no such strip).
func buildCollectorChain(p bootstrapParams) ev {
	attributionID := p.AttributionID
	if attributionID == "" {
		attributionID = p.InstanceID
	}
	headersToAdd := []any{
		// Trusted, unforgeable identity: OVERWRITE replaces any
		// agent-supplied value.
		ev{
			"header":        ev{"key": "x-platform-agent-id", "value": attributionID},
			"append_action": "OVERWRITE_IF_EXISTS_OR_ADD",
		},
	}
	route := ev{
		"match": ev{"prefix": "/"},
		"route": ev{
			"cluster":              "otel_collector",
			"host_rewrite_literal": p.TelemetryCollectorHost,
			"timeout":              "0s",
		},
	}
	if p.attributionOverridden() {
		// Stamp this target's own id as the invocation id so its merged
		// row stays distinguishable from the Driver's direct rows.
		headersToAdd = append(headersToAdd, ev{
			"header":        ev{"key": "x-platform-invocation-id", "value": p.InstanceID},
			"append_action": "OVERWRITE_IF_EXISTS_OR_ADD",
		})
	} else {
		// No override: an agent must not forge an invocation id. This
		// header is only ever added by the gateway, so drop anything the
		// agent set before it reaches the collector.
		route["request_headers_to_remove"] = []any{"x-platform-invocation-id"}
	}
	route["request_headers_to_add"] = headersToAdd
	hcm := ev{
		"@type":        "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix":  "terminate_otel_collector",
		"http_filters": []any{routerHTTPFilter()},
		"route_config": ev{
			"name": "forward_otel_collector",
			"virtual_hosts": []any{
				ev{
					"name":    "default",
					"domains": []any{"*"},
					"routes":  []any{route},
				},
			},
		},
	}
	if p.OTel.AccessLogs {
		hcm["access_log"] = collectorAccessLog(p)
	}
	return ev{
		"name":               "terminate_otel_collector",
		"filter_chain_match": ev{"server_names": []any{p.TelemetryCollectorHost}},
		"transport_socket": ev{
			"name": "envoy.transport_sockets.tls",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
				"common_tls_context": ev{
					"tls_certificates": []any{
						ev{
							"certificate_chain": ev{"filename": p.LeafTLSDir + "/tls.crt"},
							"private_key":       ev{"filename": p.LeafTLSDir + "/tls.key"},
						},
					},
				},
			},
		},
		"filters": []any{ev{"name": "envoy.filters.network.http_connection_manager", "typed_config": hcm}},
	}
}

// buildL4CatchAllChain gates every SNI-miss host by SNI alone via the
// api-server's gRPC ext_authz endpoint, then TCP-passes-through to the real
// upstream. No TLS termination, no credential injection.
func buildL4CatchAllChain(p bootstrapParams) ev {
	tcpProxy := ev{
		"@type":       "type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy",
		"stat_prefix": "l4_authz_forward",
		"cluster":     "dynamic_forward_proxy_tcp",
	}
	if p.OTel.AccessLogs {
		tcpProxy["access_log"] = l4AccessLog(p)
	}
	return ev{
		"name": "l4_authz_passthrough",
		"filters": []any{
			ev{
				"name": "envoy.filters.network.ext_authz",
				"typed_config": ev{
					"@type":                 "type.googleapis.com/envoy.extensions.filters.network.ext_authz.v3.ExtAuthz",
					"stat_prefix":           "l4_authz",
					"transport_api_version": "V3",
					"failure_mode_allow":    false,
					// Envoy only populates tls_session.sni when this is set;
					// without it the gate sees host=null and denies every L4
					// request with "missing host/sni".
					"include_tls_session": true,
					"grpc_service": ev{
						"envoy_grpc": ev{"cluster_name": "ext_authz_cluster", "authority": p.ExtAuthzHost},
						"timeout":    fmt.Sprintf("%ds", p.ExtAuthzTimeoutSeconds),
					},
				},
			},
			ev{
				"name": "envoy.filters.network.sni_dynamic_forward_proxy",
				"typed_config": ev{
					"@type":            "type.googleapis.com/envoy.extensions.filters.network.sni_dynamic_forward_proxy.v3.FilterConfig",
					"port_value":       443,
					"dns_cache_config": dnsCacheConfig(),
				},
			},
			ev{"name": "envoy.filters.network.tcp_proxy", "typed_config": tcpProxy},
		},
	}
}

// --- clusters ---

func buildClusters(p bootstrapParams) []any {
	clusters := []any{
		ev{
			"name":            "tls_inspect_internal",
			"connect_timeout": "1s",
			"load_assignment": ev{
				"cluster_name": "tls_inspect_internal",
				"endpoints": []any{
					ev{"lb_endpoints": []any{
						ev{"endpoint": ev{"address": ev{"envoy_internal_address": ev{"server_listener_name": "tls_inspect_internal"}}}},
					}},
				},
			},
		},
		dynamicForwardProxyCluster("dynamic_forward_proxy_https", true),
		dynamicForwardProxyCluster("dynamic_forward_proxy_tcp", false),
		// Plain-HTTP forward cluster for the outer HCM's fallthrough route.
		dynamicForwardProxyCluster("dynamic_forward_proxy_http", false),
		// Pinned TCP-passthrough upstream for harness CONNECT tunnels.
		pinnedTCPCluster("harness_passthrough", p.HarnessHost, p.HarnessPort),
	}
	if p.ObjectStoreAuthority != "" {
		clusters = append(clusters, pinnedTCPCluster("objectstore_passthrough", p.ObjectStoreHost, p.ObjectStorePort))
	}
	for _, c := range p.Chains {
		if c.Credentialed() {
			clusters = append(clusters, buildUpstreamCluster(c))
		}
	}
	if p.Telemetry {
		// Pinned plaintext collector upstream — ztunnel wraps the in-cluster
		// hop in mTLS transparently, so no upstream TLS here.
		clusters = append(clusters, pinnedTCPCluster("otel_collector", p.TelemetryCollectorHost, p.TelemetryCollectorPort))
	}
	// Single gRPC ext_authz cluster shared by both filters. HTTP/2 framing so
	// Envoy speaks gRPC. STRICT_DNS but no explicit dns_lookup_family (matches
	// the original config).
	clusters = append(clusters, ev{
		"name":            "ext_authz_cluster",
		"connect_timeout": "1s",
		"type":            "STRICT_DNS",
		"lb_policy":       "ROUND_ROBIN",
		"typed_extension_protocol_options": ev{
			"envoy.extensions.upstreams.http.v3.HttpProtocolOptions": ev{
				"@type":                "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
				"explicit_http_config": ev{"http2_protocol_options": ev{}},
			},
		},
		"load_assignment": socketLoadAssignment("ext_authz_cluster", p.ExtAuthzHost, p.ExtAuthzPort),
	})
	if p.OTel.Collector {
		clusters = append(clusters, buildOTelExportCluster(p))
	}
	return clusters
}

func dynamicForwardProxyCluster(name string, withTLS bool) ev {
	c := ev{
		"name":            name,
		"connect_timeout": "5s",
		"lb_policy":       "CLUSTER_PROVIDED",
		"cluster_type": ev{
			"name": "envoy.clusters.dynamic_forward_proxy",
			"typed_config": ev{
				"@type":            "type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig",
				"dns_cache_config": dnsCacheConfig(),
			},
		},
	}
	if withTLS {
		// Trust the host's system root CA bundle. envoy-distroless ships one
		// at this path; system_root_certs is gated behind a runtime flag in
		// 1.32, so point at it explicitly.
		c["transport_socket"] = ev{
			"name": "envoy.transport_sockets.tls",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
				"common_tls_context": ev{
					"validation_context": ev{"trusted_ca": ev{"filename": "/etc/ssl/certs/ca-certificates.crt"}},
				},
			},
		}
	}
	return c
}

func pinnedTCPCluster(name, host string, port int) ev {
	return ev{
		"name":              name,
		"connect_timeout":   "5s",
		"type":              "STRICT_DNS",
		"dns_lookup_family": "V4_PREFERRED",
		"lb_policy":         "ROUND_ROBIN",
		"load_assignment":   socketLoadAssignment(name, host, port),
	}
}

// buildUpstreamCluster is the pinned upstream for a credentialed chain.
// STRICT_DNS resolves the host directly; the agent's Host header plays no role
// in destination selection. Upstream TLS hard-binds SNI and SAN-validates the
// upstream cert against the host, so a poisoned cache or misrouted endpoint
// fails the handshake before any credentialed body is on the wire.
func buildUpstreamCluster(c envoyHostChain) ev {
	trustedCA := "/etc/ssl/certs/ca-certificates.crt"
	if c.UpstreamCAFile != "" {
		// Private CA for this chain only; SAN pinning below unchanged.
		trustedCA = c.UpstreamCAFile
	}
	cluster := ev{
		"name":              c.UpstreamCluster,
		"connect_timeout":   "5s",
		"type":              "STRICT_DNS",
		"dns_lookup_family": "V4_PREFERRED",
		"lb_policy":         "ROUND_ROBIN",
		"load_assignment":   socketLoadAssignment(c.UpstreamCluster, c.Host, c.UpstreamPortValue()),
		"transport_socket": ev{
			"name": "envoy.transport_sockets.tls",
			"typed_config": ev{
				"@type":         "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
				"sni":           c.Host,
				"auto_host_sni": false,
				"common_tls_context": ev{
					"validation_context": ev{
						"trusted_ca":                    ev{"filename": trustedCA},
						"match_typed_subject_alt_names": []any{ev{"san_type": "DNS", "matcher": ev{"exact": c.Host}}},
					},
				},
			},
		},
	}
	if c.HTTP2 {
		// gRPC chain: mirror the downstream-negotiated protocol upstream so
		// credential injection applies to the gRPC stream. REST chains omit
		// this and stay HTTP/1.1.
		cluster["typed_extension_protocol_options"] = ev{
			"envoy.extensions.upstreams.http.v3.HttpProtocolOptions": ev{
				"@type": "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
				"use_downstream_protocol_config": ev{
					"http_protocol_options":  ev{},
					"http2_protocol_options": ev{},
				},
			},
		}
	}
	return cluster
}

// buildOTelExportCluster dials the OTLP endpoint for the gateway's OWN traces
// and metrics. Distinct from otel_collector, which forwards the AGENT's
// telemetry. Rendered only when telemetry is on.
func buildOTelExportCluster(p bootstrapParams) ev {
	cluster := ev{
		"name":              "otel_export",
		"connect_timeout":   "5s",
		"type":              "STRICT_DNS",
		"dns_lookup_family": "V4_PREFERRED",
		"lb_policy":         "ROUND_ROBIN",
		"load_assignment":   socketLoadAssignment("otel_export", p.OTel.CollectorHost, p.OTel.CollectorPort),
	}
	if p.OTel.GRPC {
		cluster["typed_extension_protocol_options"] = ev{
			"envoy.extensions.upstreams.http.v3.HttpProtocolOptions": ev{
				"@type":                "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
				"explicit_http_config": ev{"http2_protocol_options": ev{}},
			},
		}
	}
	if p.OTel.Secure {
		cluster["transport_socket"] = ev{
			"name": "envoy.transport_sockets.tls",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
				"sni":   p.OTel.CollectorHost,
				"common_tls_context": ev{
					"validation_context": ev{"trusted_ca": ev{"filename": "/etc/ssl/certs/ca-certificates.crt"}},
				},
			},
		}
	}
	return cluster
}

func socketLoadAssignment(clusterName, host string, port int) ev {
	return ev{
		"cluster_name": clusterName,
		"endpoints": []any{
			ev{"lb_endpoints": []any{
				ev{"endpoint": ev{"address": ev{"socket_address": ev{"address": host, "port_value": port}}}},
			}},
		},
	}
}

// --- shared filter / logging fragments ---

func extAuthzHTTPFilter(p bootstrapParams) ev {
	return ev{
		"name": "envoy.filters.http.ext_authz",
		"typed_config": ev{
			"@type":                 "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz",
			"transport_api_version": "V3",
			"failure_mode_allow":    false,
			"grpc_service": ev{
				// Pin :authority to the per-instance ext-authz Service
				// hostname so the api-server can derive instance ID from it.
				"envoy_grpc": ev{"cluster_name": "ext_authz_cluster", "authority": p.ExtAuthzHost},
				"timeout":    fmt.Sprintf("%ds", p.ExtAuthzTimeoutSeconds),
			},
		},
	}
}

func extAuthzDisabledPerRoute() ev {
	return ev{
		"envoy.filters.http.ext_authz": ev{
			"@type":    "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute",
			"disabled": true,
		},
	}
}

func dynamicForwardProxyHTTPFilter() ev {
	return ev{
		"name": "envoy.filters.http.dynamic_forward_proxy",
		"typed_config": ev{
			"@type":            "type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig",
			"dns_cache_config": dnsCacheConfig(),
		},
	}
}

func routerHTTPFilter() ev {
	return ev{
		"name":         "envoy.filters.http.router",
		"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router"},
	}
}

func dnsCacheConfig() ev {
	return ev{"name": "dns_cache", "dns_lookup_family": "V4_PREFERRED"}
}

// otelTracing builds the OpenTelemetry tracing config shared (bar the path-tag
// cap) by the outer HCM and the terminating chains.
func otelTracing(p bootstrapParams, maxPathTagLength int) ev {
	tracerTC := ev{
		"@type":        "type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig",
		"service_name": p.OTel.ServiceName,
		"resource_detectors": []any{
			ev{
				"name":         "envoy.tracers.opentelemetry.resource_detectors.environment",
				"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.tracers.opentelemetry.resource_detectors.v3.EnvironmentResourceDetectorConfig"},
			},
		},
	}
	if p.OTel.GRPC {
		tracerTC["grpc_service"] = otlpGRPCService()
	} else {
		tracerTC["http_service"] = otlpHTTPService(p.OTel.TracesURI)
	}
	return ev{
		"spawn_upstream_span": false,
		"max_path_tag_length": maxPathTagLength,
		"random_sampling":     ev{"value": p.OTel.SamplingPercent},
		"provider":            ev{"name": "envoy.tracers.opentelemetry", "typed_config": tracerTC},
	}
}

func otlpGRPCService() ev {
	return ev{"envoy_grpc": ev{"cluster_name": "otel_export"}, "timeout": "5s"}
}

func otlpHTTPService(uri string) ev {
	return ev{"http_uri": ev{"uri": uri, "cluster": "otel_export", "timeout": "5s"}}
}

func reqWithoutQueryFormatters() []any {
	return []any{
		ev{
			"name":         "envoy.formatter.req_without_query",
			"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery"},
		},
	}
}

func otlpResourceAttrs(serviceName, agentID string) ev {
	return ev{"values": []any{
		alAttr("service.name", serviceName),
		alAttr("platform.gateway.id", agentID),
	}}
}

func alAttr(key, val string) ev {
	return ev{"key": key, "value": ev{"string_value": val}}
}

// hcmAccessLog builds the file + OTLP access-log pair for an HCM. fileChain is
// the `chain` field stamped on the file log (empty on the outer HCM, which
// omits it); otlpChain is the OTLP `chain` attribute (always present); every
// field is credential-safe (REQ_WITHOUT_QUERY, no Authorization reference).
func hcmAccessLog(p bootstrapParams, fileChain, otlpChain, statPrefix string) []any {
	fileJSON := ev{
		"service_name":   p.OTel.ServiceName,
		"agent_id":       p.OTel.AgentID,
		"start_time":     "%START_TIME%",
		"method":         "%REQ(:METHOD)%",
		"authority":      "%REQ(:AUTHORITY)%",
		"path":           "%REQ_WITHOUT_QUERY(:PATH)%",
		"response_code":  "%RESPONSE_CODE%",
		"response_flags": "%RESPONSE_FLAGS%",
		"duration_ms":    "%DURATION%",
		"upstream_host":  "%UPSTREAM_HOST%",
		"bytes_received": "%BYTES_RECEIVED%",
		"bytes_sent":     "%BYTES_SENT%",
		"x_request_id":   "%REQ(X-REQUEST-ID)%",
	}
	if fileChain != "" {
		fileJSON["chain"] = fileChain
	}
	otlpTC := ev{
		"@type":                  "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
		"stat_prefix":            statPrefix,
		"disable_builtin_labels": true,
		"formatters":             reqWithoutQueryFormatters(),
		"resource_attributes":    otlpResourceAttrs(p.OTel.ServiceName, p.OTel.AgentID),
		"body":                   ev{"string_value": "%REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE%"},
		"attributes": ev{"values": []any{
			alAttr("chain", otlpChain),
			alAttr("method", "%REQ(:METHOD)%"),
			alAttr("authority", "%REQ(:AUTHORITY)%"),
			alAttr("path", "%REQ_WITHOUT_QUERY(:PATH)%"),
			alAttr("response_code", "%RESPONSE_CODE%"),
			alAttr("response_flags", "%RESPONSE_FLAGS%"),
			alAttr("duration_ms", "%DURATION%"),
			alAttr("upstream_host", "%UPSTREAM_HOST%"),
			alAttr("bytes_received", "%BYTES_RECEIVED%"),
			alAttr("bytes_sent", "%BYTES_SENT%"),
			alAttr("x_request_id", "%REQ(X-REQUEST-ID)%"),
		}},
	}
	if p.OTel.GRPC {
		otlpTC["grpc_service"] = otlpGRPCService()
	} else {
		otlpTC["http_service"] = otlpHTTPService(p.OTel.LogsURI)
	}
	return []any{
		ev{
			"name": "envoy.access_loggers.file",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
				"path":  "/dev/stdout",
				"log_format": ev{
					"formatters":  reqWithoutQueryFormatters(),
					"json_format": fileJSON,
				},
			},
		},
		ev{"name": "envoy.access_loggers.open_telemetry", "typed_config": otlpTC},
	}
}

// collectorAccessLog is error-only: agent-telemetry delivery failures are
// otherwise invisible (this chain has no tracing and the stats sink is off on
// OTLP/HTTP). Steady-state success volume stays zero.
func collectorAccessLog(p bootstrapParams) []any {
	errFilter := ev{
		"or_filter": ev{
			"filters": []any{
				ev{"status_code_filter": ev{"comparison": ev{
					"op":    "GE",
					"value": ev{"default_value": 400, "runtime_key": "access_log.otel_collector.min_status"},
				}}},
				ev{"response_flag_filter": ev{}},
			},
		},
	}
	otlpTC := ev{
		"@type":                  "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
		"stat_prefix":            "otel_transit",
		"disable_builtin_labels": true,
		"formatters":             reqWithoutQueryFormatters(),
		"resource_attributes":    otlpResourceAttrs(p.OTel.ServiceName, p.OTel.AgentID),
		"body":                   ev{"string_value": "telemetry delivery failure %REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE% %RESPONSE_FLAGS%"},
		"attributes": ev{"values": []any{
			alAttr("chain", "terminate_otel_collector"),
			alAttr("method", "%REQ(:METHOD)%"),
			alAttr("path", "%REQ_WITHOUT_QUERY(:PATH)%"),
			alAttr("response_code", "%RESPONSE_CODE%"),
			alAttr("response_flags", "%RESPONSE_FLAGS%"),
			alAttr("duration_ms", "%DURATION%"),
			alAttr("upstream_host", "%UPSTREAM_HOST%"),
		}},
	}
	if p.OTel.GRPC {
		otlpTC["grpc_service"] = otlpGRPCService()
	} else {
		otlpTC["http_service"] = otlpHTTPService(p.OTel.LogsURI)
	}
	return []any{
		ev{
			"name": "envoy.access_loggers.file",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
				"path":  "/dev/stdout",
				"log_format": ev{
					"formatters": reqWithoutQueryFormatters(),
					"json_format": ev{
						"service_name":   p.OTel.ServiceName,
						"agent_id":       p.OTel.AgentID,
						"chain":          "terminate_otel_collector",
						"start_time":     "%START_TIME%",
						"method":         "%REQ(:METHOD)%",
						"path":           "%REQ_WITHOUT_QUERY(:PATH)%",
						"response_code":  "%RESPONSE_CODE%",
						"response_flags": "%RESPONSE_FLAGS%",
						"duration_ms":    "%DURATION%",
						"upstream_host":  "%UPSTREAM_HOST%",
					},
				},
			},
			"filter": errFilter,
		},
		ev{"name": "envoy.access_loggers.open_telemetry", "typed_config": otlpTC, "filter": errFilter},
	}
}

// l4AccessLog records SNI-passthrough egress: requested server name + byte
// counts only. L4, so there is no path/query and nothing to redact.
func l4AccessLog(p bootstrapParams) []any {
	otlpTC := ev{
		"@type":                  "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
		"stat_prefix":            "l4",
		"disable_builtin_labels": true,
		"resource_attributes":    otlpResourceAttrs(p.OTel.ServiceName, p.OTel.AgentID),
		"body":                   ev{"string_value": "SNI %REQUESTED_SERVER_NAME%"},
		"attributes": ev{"values": []any{
			alAttr("chain", "l4_authz_passthrough"),
			alAttr("requested_server_name", "%REQUESTED_SERVER_NAME%"),
			alAttr("upstream_host", "%UPSTREAM_HOST%"),
			alAttr("response_flags", "%RESPONSE_FLAGS%"),
			alAttr("duration_ms", "%DURATION%"),
			alAttr("bytes_received", "%BYTES_RECEIVED%"),
			alAttr("bytes_sent", "%BYTES_SENT%"),
		}},
	}
	if p.OTel.GRPC {
		otlpTC["grpc_service"] = otlpGRPCService()
	} else {
		otlpTC["http_service"] = otlpHTTPService(p.OTel.LogsURI)
	}
	return []any{
		ev{
			"name": "envoy.access_loggers.file",
			"typed_config": ev{
				"@type": "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
				"path":  "/dev/stdout",
				"log_format": ev{
					"json_format": ev{
						"service_name":          p.OTel.ServiceName,
						"agent_id":              p.OTel.AgentID,
						"chain":                 "l4_authz_passthrough",
						"start_time":            "%START_TIME%",
						"requested_server_name": "%REQUESTED_SERVER_NAME%",
						"upstream_host":         "%UPSTREAM_HOST%",
						"response_flags":        "%RESPONSE_FLAGS%",
						"duration_ms":           "%DURATION%",
						"bytes_received":        "%BYTES_RECEIVED%",
						"bytes_sent":            "%BYTES_SENT%",
					},
				},
			},
		},
		ev{"name": "envoy.access_loggers.open_telemetry", "typed_config": otlpTC},
	}
}

// luaQueryParamScript renders the Lua source that moves a credential from an
// injected header into a URL query parameter. HEADER and PARAM are embedded as
// Lua string literals via strconv.Quote — the value never reaches the wire as
// unescaped Lua source (the YAML layer is handled by the encoder). PARAM is
// api-server-validated against the URL-safe charset; the credential value is
// percent-encoded inside the script before it lands in the query string.
func luaQueryParamScript(header, param string) string {
	return fmt.Sprintf(`local HEADER = %s
local PARAM  = %s
-- Percent-encode every byte outside RFC 3986 unreserved. Without this, a
-- credential containing & or = would break out of its query parameter — the
-- splitter below frames on those bytes literally. We encode the credential
-- value but not PARAM (PARAM is api-server-validated against the URL-safe
-- charset, so it's already safe).
local function urlencode(s)
  return (string.gsub(s, "[^A-Za-z0-9%%-_.~]", function(c)
    return string.format("%%%%%%02X", string.byte(c))
  end))
end
function envoy_on_request(rh)
  local h = rh:headers()
  local cred = h:get(HEADER)
  if cred == nil or cred == "" then return end
  h:remove(HEADER)
  cred = urlencode(cred)
  local path = h:get(":path")
  if path == nil then return end
  local qi = string.find(path, "?", 1, true)
  local prefix, query
  if qi then
    prefix = string.sub(path, 1, qi)
    query  = string.sub(path, qi + 1)
  else
    prefix = path .. "?"
    query  = ""
  end
  local out = {}
  local replaced = false
  for pair in string.gmatch(query, "[^&]+") do
    local eq = string.find(pair, "=", 1, true)
    local key = eq and string.sub(pair, 1, eq - 1) or pair
    if key == PARAM then
      out[#out + 1] = PARAM .. "=" .. cred
      replaced = true
    else
      out[#out + 1] = pair
    end
  end
  if not replaced then
    out[#out + 1] = PARAM .. "=" .. cred
  end
  h:replace(":path", prefix .. table.concat(out, "&"))
end
`, strconv.Quote(header), strconv.Quote(param))
}
