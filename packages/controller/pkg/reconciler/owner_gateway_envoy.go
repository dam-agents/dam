package reconciler

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"

	sigsyaml "sigs.k8s.io/yaml"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	ownerGatewayTemplateRev = "o1-owner-gateway"
	ownerGatewayLDSKey      = "lds.yaml"
	ownerGatewayCDSKey      = "cds.yaml"
	ownerGatewayLeafSDSKey  = "leaf-sds.yaml"
	ownerGatewayBootstrap   = "envoy.yaml"
	envoyLeafSDSName        = "leaf"
	harnessGuardHeader      = "x-platform-harness-agent"
)

type ownerGatewayAgent struct {
	Name          string
	AttributionID string
	ProxyPort     int
	Chains        []envoyHostChain
}

type ownerGatewayConfig struct {
	Bootstrap string
	LDS       string
	CDS       string
	LeafSDS   string
	Lua       map[string]string
	Revisions map[string]string
}

// UNIT_BOUNDARY_DESCRIPTION: the Envoy configuration of an owner gateway, which serves every vm Agent of one owner. The bootstrap holds only what the agents share: the internal-listener extension, the stats sink and the clusters to the harness, the object store, the dynamic forward proxies and the collector. Each agent's listeners and clusters are files Envoy watches, every name suffixed with the agent, so one agent's change replaces only its own listener and drains only its own connections. Identity is the listener's port, which only the agent's own Service maps to. The mesh no longer tells an owner's agents apart at the harness, so each agent's harness route ends in a guard listener that admits only that agent's own path and stamps the agent on the request; every other route strips that header, and the agent's harness policy requires it. The listener answers its health path with a revision of what was rendered for it, so a readiness probe tells a stale listener from a current one. Size: about 11 KB shared plus 4 KB per credentialed host before spend metering; one ConfigMap holds at most 1 MiB, and an owner past that needs an xDS server in the controller instead of files.
// UNIT_BOUNDARY_DESCRIPTION: `repair` carries what a render owes an owner's agents, and is nil for a plain one: a version of the files that changes while they are being re-applied, and a per-agent listener generation that makes Envoy recreate a listener it accepted with a signing provider it never loaded.
func renderOwnerGateway(agents []ownerGatewayAgent, cfg *config.Config, repair *ownerGatewayRepairPlan) (ownerGatewayConfig, error) {
	var listeners, clusters []any
	revisions := map[string]string{}
	var shared bootstrapParams
	for i, a := range agents {
		p := ownerAgentParams(a, cfg)
		if i == 0 {
			shared = p
		}
		agentListeners, agentClusters := ownerAgentResources(p)
		p.HealthBody = ownerAgentRevision(agentListeners, agentClusters)
		revisions[a.Name] = p.HealthBody
		if repair != nil {
			p.RepairGeneration = repair.generation(a.Name, p.HealthBody, slices.ContainsFunc(a.Chains, func(c envoyHostChain) bool { return len(c.Signers) > 0 }))
		}
		agentListeners, agentClusters = ownerAgentResources(p)
		listeners = append(listeners, agentListeners...)
		clusters = append(clusters, agentClusters...)
	}
	if len(agents) == 0 {
		shared = newBootstrapParams("", "", cfg, nil, true)
	}
	bootstrap := ev{
		"node": ev{"id": "platform-owner-gateway", "cluster": "platform-owner-gateway"},
		"bootstrap_extensions": []any{ev{
			"name":         "envoy.bootstrap.internal_listener",
			"typed_config": ev{"@type": "type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener"},
		}},
		"static_resources": ev{"clusters": ownerSharedClusters(shared), "listeners": []any{ownerHealthListener(cfg.EnvoyPort)}},
		"dynamic_resources": ev{
			"lds_config": watchedConfigSource(ownerGatewayLDSKey),
			"cds_config": watchedConfigSource(ownerGatewayCDSKey),
		},
	}
	addStatsSink(bootstrap, shared)
	out := ownerGatewayConfig{Revisions: revisions, Lua: map[string]string{
		luaSpendMeterKey:        luaSpendMeterBody,
		luaConnectionAddressKey: luaConnectionAddressBody,
		luaSigningGuardKey:      luaSigningGuardBody,
	}}
	var err error
	if out.Bootstrap, err = marshalYAML(bootstrap); err != nil {
		return out, err
	}
	if out.LDS, err = marshalYAML(discoveryResponse("type.googleapis.com/envoy.config.listener.v3.Listener", repair.xdsVersion(), listeners)); err != nil {
		return out, err
	}
	if out.CDS, err = marshalYAML(discoveryResponse("type.googleapis.com/envoy.config.cluster.v3.Cluster", repair.xdsVersion(), clusters)); err != nil {
		return out, err
	}
	out.LeafSDS, err = marshalYAML(discoveryResponse("type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret", repair.xdsVersion(), []any{ev{
		"name": envoyLeafSDSName,
		"tls_certificate": ev{
			"certificate_chain": ev{"filename": envoyLeafTLSMount + "/tls.crt"},
			"private_key":       ev{"filename": envoyLeafTLSMount + "/tls.key"},
			"watched_directory": ev{"path": envoyLeafTLSMount},
		},
	}}))
	return out, err
}

func ownerAgentParams(a ownerGatewayAgent, cfg *config.Config) bootstrapParams {
	suffix := "_" + a.Name
	chains := make([]envoyHostChain, len(a.Chains))
	for i, c := range a.Chains {
		c.ChainID += suffix
		c.UpstreamCluster += suffix
		if rest, ok := strings.CutPrefix(c.UpstreamCAFile, envoyCredentialsRoot+"/cred-"); ok {
			c.UpstreamCAFile = envoyCredentialsRoot + "/" + strings.Replace(rest, "/", ".", 1)
		}
		chains[i] = c
	}
	p := newBootstrapParams(a.Name, a.AttributionID, cfg, chains, true)
	p.Port = a.ProxyPort
	p.Suffix = suffix
	p.HarnessGuardAgent = a.Name
	p.HealthBody = "pending"
	p.FlatCredentials = true
	p.LeafSDSPath = envoyBootstrapMount + "/" + ownerGatewayLeafSDSKey
	p.LuaDir = envoyBootstrapMount
	return p
}

func ownerAgentResources(p bootstrapParams) (listeners, clusters []any) {
	listeners = []any{buildOuterListener(p), buildInternalListener(p), harnessGuardListener(p)}
	clusters = []any{internalListenerCluster(p.named("tls_inspect_internal")), internalListenerCluster(p.named("harness_guard")), extAuthzCluster(p)}
	for _, c := range p.Chains {
		if c.Credentialed() {
			clusters = append(clusters, buildUpstreamCluster(c, p.UpstreamTrustedCA))
		}
	}
	return listeners, clusters
}

func ownerAgentRevision(listeners, clusters []any) string {
	raw, _ := sigsyaml.Marshal([]any{ownerGatewayTemplateRev, listeners, clusters})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8])
}

func ownerHealthListener(port int) ev {
	return ev{
		"name":    "owner_gateway_health",
		"address": ev{"socket_address": ev{"address": envoyListenAddress, "port_value": port}},
		"filter_chains": []any{ev{"filters": []any{ev{
			"name": "envoy.filters.network.http_connection_manager",
			"typed_config": ev{
				"@type":        "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
				"stat_prefix":  "owner_gateway_health",
				"http_filters": []any{routerHTTPFilter()},
				"route_config": ev{"virtual_hosts": []any{ev{
					"name":    "health",
					"domains": []any{"*"},
					"routes":  []any{ev{"match": ev{"path": platformGatewayHealthPath}, "direct_response": ev{"status": 200}}},
				}}},
			},
		}}}},
	}
}
func ownerSharedClusters(p bootstrapParams) []any {
	clusters := []any{
		dynamicForwardProxyCluster("dynamic_forward_proxy_https", true, p.UpstreamTrustedCA),
		dynamicForwardProxyCluster("dynamic_forward_proxy_tcp", false, ""),
		dynamicForwardProxyCluster("dynamic_forward_proxy_http", false, ""),
		pinnedTCPCluster("harness_passthrough", p.HarnessHost, p.HarnessPort),
	}
	if p.ObjectStoreAuthority != "" {
		clusters = append(clusters, pinnedTCPCluster("objectstore_passthrough", p.ObjectStoreHost, p.ObjectStorePort))
	}
	if p.Telemetry {
		clusters = append(clusters, pinnedTCPCluster("otel_collector", p.TelemetryCollectorHost, p.TelemetryCollectorPort))
	}
	if p.OTel.Collector {
		clusters = append(clusters, buildOTelExportCluster(p))
	}
	return clusters
}

// UNIT_BOUNDARY_DESCRIPTION: the harness guard of one agent. A CONNECT to the harness authority, and a plain request for it, both end here as HTTP, so the guard reads the path. Only the agent's own `/api/agents/<id>/` prefix reaches the harness, WebSocket upgrades included for the runtime's tRPC, and the request leaves stamped with the agent; anything else is refused here. Paths are normalized and merged, and escaped slashes refused, before the match, so `..` or `%2F` cannot step into a sibling's prefix.
func harnessGuardListener(p bootstrapParams) ev {
	prefix := fmt.Sprintf("/api/agents/%s/", p.HarnessGuardAgent)
	hcm := ev{
		"@type":                            "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
		"stat_prefix":                      p.named("harness_guard"),
		"normalize_path":                   true,
		"merge_slashes":                    true,
		"path_with_escaped_slashes_action": "REJECT_REQUEST",
		"upgrade_configs":                  []any{ev{"upgrade_type": "websocket"}},
		"http_filters":                     []any{routerHTTPFilter()},
		"route_config": ev{
			"name": p.named("harness_guard"),
			"virtual_hosts": []any{ev{
				"name":    "harness",
				"domains": []any{"*"},
				"routes": []any{
					ev{
						"match": ev{"prefix": prefix},
						"route": ev{"cluster": "harness_passthrough", "timeout": "0s"},
						"request_headers_to_add": []any{ev{
							"header":        ev{"key": harnessGuardHeader, "value": p.HarnessGuardAgent},
							"append_action": "OVERWRITE_IF_EXISTS_OR_ADD",
						}},
					},
					ev{
						"match":           ev{"prefix": "/"},
						"direct_response": ev{"status": 403, "body": ev{"inline_string": "This gateway serves the harness only under " + prefix + "\n"}},
					},
				},
			}},
		},
	}
	return ev{
		"name":              p.named("harness_guard"),
		"internal_listener": ev{},
		"filter_chains": []any{ev{"filters": []any{ev{
			"name":         "envoy.filters.network.http_connection_manager",
			"typed_config": hcm,
		}}}},
	}
}

func watchedConfigSource(key string) ev {
	return ev{
		"path_config_source": ev{
			"path":              envoyBootstrapMount + "/" + key,
			"watched_directory": ev{"path": envoyBootstrapMount},
		},
		"resource_api_version": "V3",
	}
}

func discoveryResponse(typeURL, version string, resources []any) ev {
	typed := make([]any, 0, len(resources))
	for _, r := range resources {
		withType := ev{"@type": typeURL}
		for k, v := range r.(ev) {
			withType[k] = v
		}
		typed = append(typed, withType)
	}
	return ev{"version_info": cmp.Or(version, ownerGatewayTemplateRev), "type_url": typeURL, "resources": typed}
}

func marshalYAML(doc any) (string, error) {
	out, err := sigsyaml.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("marshaling owner gateway config: %w", err)
	}
	return string(out), nil
}
