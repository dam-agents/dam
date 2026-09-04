package reconciler

import (
	"fmt"
	"strconv"

	sigsyaml "sigs.k8s.io/yaml"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

type ev = map[string]any

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
	AttributionID          string
	AnyUpgrades            bool
	OTel                   envoyOTelView
}

func (p bootstrapParams) attributionOverridden() bool {
	return p.AttributionID != "" && p.AttributionID != p.InstanceID
}

func renderEnvoyBootstrap(instanceID, attributionID string, cfg *config.Config, chains []envoyHostChain) (string, error) {
	extAuthzTimeoutSeconds := cfg.ExtAuthzHoldSeconds + 60
	harnessAuthority := fmt.Sprintf("%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)
	objectStoreAuthority := ""
	if cfg.ObjectStoreHost != "" {
		objectStoreAuthority = fmt.Sprintf("%s:%d", cfg.ObjectStoreHost, cfg.ObjectStorePort)
	}
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

func buildOuterListener(p bootstrapParams) ev {
	hcm := ev{
		"@type":       "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix": "agent_egress",
		"upgrade_configs": []any{
			ev{"upgrade_type": "CONNECT"},
			ev{"upgrade_type": "websocket"},
		},
		"http_filters": []any{
			ev{
				"name": "envoy.filters.http.health_check",
				"typed_config": ev{
					"@type":             "type.googleapis.com/envoy.extensions.filters.http.health_check.v3.HealthCheck",
					"pass_through_mode": false,
					"headers":           []any{ev{"name": ":path", "string_match": ev{"exact": p.HealthPath}}},
				},
			},
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
		routes = append(routes, ev{
			"match": ev{
				"connect_matcher": ev{},
				"headers":         []any{ev{"name": ":authority", "string_match": ev{"exact": p.ObjectStoreAuthority}}},
			},
			"route": ev{"cluster": "objectstore_passthrough", "upgrade_configs": connectUpgrade},
		})
	}
	if p.Telemetry && p.OTel.Traces {
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
	genericRoute := ev{"cluster": "tls_inspect_internal", "upgrade_configs": connectUpgrade}
	if p.AnyUpgrades {
		genericRoute["idle_timeout"] = "14400s"
	}
	routes = append(routes, ev{
		"match":                   ev{"connect_matcher": ev{}},
		"route":                   genericRoute,
		"typed_per_filter_config": extAuthzDisabledPerRoute(),
	})
	routes = append(routes, ev{
		"match": ev{
			"prefix":  "/",
			"headers": []any{ev{"name": ":authority", "string_match": ev{"exact": p.HarnessAuthority}}},
		},
		"route":                   ev{"cluster": "dynamic_forward_proxy_http", "timeout": "0s"},
		"typed_per_filter_config": extAuthzDisabledPerRoute(),
	})
	fallthroughRoute := ev{
		"match": ev{"prefix": "/"},
		"route": ev{"cluster": "dynamic_forward_proxy_http", "timeout": "0s"},
	}
	if p.OTel.Traces {
		fallthroughRoute["request_headers_to_remove"] = []any{"traceparent", "tracestate"}
	}
	routes = append(routes, fallthroughRoute)
	return routes
}

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
		commonTLS["alpn_protocols"] = []any{"h2", "http/1.1"}
	}

	hcm := ev{
		"@type":        "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix":  "terminate_" + c.ChainID,
		"http_filters": buildChainHTTPFilters(p, c),
		"route_config": ev{
			"name": "forward_" + c.ChainID,
			"virtual_hosts": []any{
				ev{"name": "default", "domains": []any{"*"}, "routes": buildChainForwardRoutes(c)},
			},
		},
	}
	if c.Upgrades {
		hcm["upgrade_configs"] = []any{ev{"upgrade_type": "websocket"}, ev{"upgrade_type": "spdy/3.1"}}
	}
	if p.OTel.Traces && !c.HasQueryParamCredential() {
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
									"path":              p.CredentialsRoot + "/" + cred.VolumeName + "/" + cred.SDSFileKey,
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

func buildChainForwardRoutes(c envoyHostChain) []any {
	routes := make([]any, 0, len(c.PathRewrites)+1)
	for _, r := range c.PathRewrites {
		route := buildChainRouteAction(c)
		route["prefix_rewrite"] = r.Replacement
		routes = append(routes, ev{"match": ev{"prefix": r.Prefix}, "route": route})
	}
	return append(routes, ev{"match": ev{"prefix": "/"}, "route": buildChainRouteAction(c)})
}

func buildChainRouteAction(c envoyHostChain) ev {
	route := ev{"timeout": "0s"}
	if c.Credentialed() {
		route["cluster"] = c.UpstreamCluster
		route["host_rewrite_literal"] = c.HostRewrite()
	} else {
		route["cluster"] = "dynamic_forward_proxy_https"
	}
	if c.Upgrades {
		route["idle_timeout"] = "14400s"
	}
	return route
}

func buildCollectorChain(p bootstrapParams) ev {
	attributionID := p.AttributionID
	if attributionID == "" {
		attributionID = p.InstanceID
	}
	headersToAdd := []any{
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
		headersToAdd = append(headersToAdd, ev{
			"header":        ev{"key": "x-platform-invocation-id", "value": p.InstanceID},
			"append_action": "OVERWRITE_IF_EXISTS_OR_ADD",
		})
	} else {
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
					"include_tls_session":   true,
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
		dynamicForwardProxyCluster("dynamic_forward_proxy_http", false),
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
		clusters = append(clusters, pinnedTCPCluster("otel_collector", p.TelemetryCollectorHost, p.TelemetryCollectorPort))
	}
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

func buildUpstreamCluster(c envoyHostChain) ev {
	trustedCA := "/etc/ssl/certs/ca-certificates.crt"
	if c.UpstreamCAFile != "" {
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

func extAuthzHTTPFilter(p bootstrapParams) ev {
	return ev{
		"name": "envoy.filters.http.ext_authz",
		"typed_config": ev{
			"@type":                 "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz",
			"transport_api_version": "V3",
			"failure_mode_allow":    false,
			"grpc_service": ev{
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
