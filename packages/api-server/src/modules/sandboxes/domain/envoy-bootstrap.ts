import yaml from "js-yaml";

/**
 * The paired gateway's Envoy configuration: the agent's only route off its
 * sandbox. Egress arrives as a CONNECT proxy request, is TLS-terminated per
 * host so a credential can be injected on the wire, and is gated per request
 * by the api-server's ext_authz.
 *
 * Two hops that used to be TCP services in the cluster are unix sockets here.
 * That is the whole of the identity story on one node: the socket a request
 * arrives on names the agent, the socket is created 0600 under the gateway's
 * own uid, and nothing the agent controls can reach another agent's. It
 * replaces the SPIFFE principal an AuthorizationPolicy used to match.
 */

type Ev = Record<string, unknown>;

export interface EnvoyCredential {
  volumeName: string;
  sdsFileKey: string;
  headerName: string;
  queryParamName?: string;
}

export interface EnvoyPathRewrite {
  prefix: string;
  replacement: string;
}

export interface EnvoyHostChain {
  chainId: string;
  host: string;
  credentials: EnvoyCredential[];
  upstreamCluster: string;
  http2?: boolean;
  upstreamPort?: number;
  upgrades?: boolean;
  upstreamCaFile?: string;
  pathRewrites?: EnvoyPathRewrite[];
}

export interface EnvoyOTelView {
  traces: boolean;
  metrics: boolean;
  accessLogs: boolean;
  collector: boolean;
  grpc: boolean;
  secure: boolean;
  collectorHost: string;
  collectorPort: number;
  tracesUri: string;
  logsUri: string;
  serviceName: string;
  agentId: string;
  samplingPercent: number;
}

export interface EnvoyBootstrapParams {
  listenAddress: string;
  port: number;
  chains: EnvoyHostChain[];
  /** Directory holding the per-credential SDS files, one subdirectory each. */
  credentialsRoot: string;
  credentialSdsName: string;
  /** Directory holding the MITM leaf `tls.crt` / `tls.key`. */
  leafTlsDir: string;
  /** `host:port` the agent addresses the harness API by. */
  harnessAuthority: string;
  /** Unix socket the harness port answers on for this agent. */
  harnessSocketPath: string;
  objectStoreAuthority?: string;
  objectStoreHost?: string;
  objectStorePort?: number;
  healthPath: string;
  /** Unix socket the ext_authz gRPC service answers on for this agent. */
  extAuthzSocketPath: string;
  extAuthzAuthority: string;
  extAuthzTimeoutSeconds: number;
  telemetry: boolean;
  telemetryCollectorHost?: string;
  telemetryCollectorPort?: number;
  agentId: string;
  attributionId?: string;
  otel: EnvoyOTelView;
}

const upstreamPortValue = (c: EnvoyHostChain) => c.upstreamPort || 443;
const hostRewrite = (c: EnvoyHostChain) =>
  upstreamPortValue(c) === 443 ? c.host : `${c.host}:${upstreamPortValue(c)}`;
const credentialed = (c: EnvoyHostChain) => c.credentials.length > 0;
const hasQueryParamCredential = (c: EnvoyHostChain) =>
  c.credentials.some((cred) => cred.queryParamName);

export function renderEnvoyBootstrap(p: EnvoyBootstrapParams): string {
  return yaml.dump(buildEnvoyBootstrap(p), { noRefs: true, lineWidth: -1 });
}

export function buildEnvoyBootstrap(p: EnvoyBootstrapParams): Ev {
  const doc: Ev = {
    node: {
      id: "platform-credential-injector",
      cluster: "platform-credential-injector",
    },
    bootstrap_extensions: [
      {
        name: "envoy.bootstrap.internal_listener",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener",
        },
      },
    ],
    static_resources: {
      listeners: [buildOuterListener(p), buildInternalListener(p)],
      clusters: buildClusters(p),
    },
  };
  if (p.otel.metrics) {
    doc.stats_sinks = [
      {
        name: "envoy.stat_sinks.open_telemetry",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.stat_sinks.open_telemetry.v3.SinkConfig",
          grpc_service: otlpGrpcService(),
        },
      },
    ];
  }
  return doc;
}

function attributionOverridden(p: EnvoyBootstrapParams): boolean {
  return !!p.attributionId && p.attributionId !== p.agentId;
}

function buildOuterListener(p: EnvoyBootstrapParams): Ev {
  const anyUpgrades = p.chains.some((c) => c.upgrades);
  const hcm: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
    stat_prefix: "agent_egress",
    upgrade_configs: [
      { upgrade_type: "CONNECT" },
      { upgrade_type: "websocket" },
    ],
    http_filters: [
      {
        name: "envoy.filters.http.health_check",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.http.health_check.v3.HealthCheck",
          pass_through_mode: false,
          headers: [{ name: ":path", string_match: { exact: p.healthPath } }],
        },
      },
      extAuthzHttpFilter(p),
      dynamicForwardProxyHttpFilter(),
      routerHttpFilter(),
    ],
    route_config: {
      name: "connect_routes",
      virtual_hosts: [
        { name: "connect", domains: ["*"], routes: buildOuterRoutes(p, anyUpgrades) },
      ],
    },
  };
  if (p.otel.traces) hcm.tracing = otelTracing(p, 256);
  if (p.otel.accessLogs) {
    hcm.access_log = hcmAccessLog(p, "", "agent_egress", "egress");
  }
  return {
    name: "agent_egress",
    address: {
      socket_address: { address: p.listenAddress, port_value: p.port },
    },
    filter_chains: [
      {
        filters: [
          {
            name: "envoy.filters.network.http_connection_manager",
            typed_config: hcm,
          },
        ],
      },
    ],
  };
}

function buildOuterRoutes(p: EnvoyBootstrapParams, anyUpgrades: boolean): Ev[] {
  const connectUpgrade = [{ upgrade_type: "CONNECT", connect_config: {} }];
  const routes: Ev[] = [
    {
      match: {
        connect_matcher: {},
        headers: [
          { name: ":authority", string_match: { exact: p.harnessAuthority } },
        ],
      },
      route: {
        cluster: "harness_passthrough",
        upgrade_configs: connectUpgrade,
      },
      typed_per_filter_config: extAuthzDisabledPerRoute(),
    },
  ];
  if (p.objectStoreAuthority) {
    routes.push({
      match: {
        connect_matcher: {},
        headers: [
          {
            name: ":authority",
            string_match: { exact: p.objectStoreAuthority },
          },
        ],
      },
      route: {
        cluster: "objectstore_passthrough",
        upgrade_configs: connectUpgrade,
      },
    });
  }
  if (p.telemetry && p.otel.traces) {
    routes.push({
      match: {
        connect_matcher: {},
        headers: [
          {
            name: ":authority",
            string_match: {
              exact: `${p.telemetryCollectorHost}:${p.telemetryCollectorPort}`,
            },
          },
        ],
      },
      route: {
        cluster: "tls_inspect_internal",
        upgrade_configs: connectUpgrade,
      },
      tracing: {
        random_sampling: { numerator: 0 },
        overall_sampling: { numerator: 0 },
      },
      typed_per_filter_config: extAuthzDisabledPerRoute(),
    });
  }
  const genericRoute: Ev = {
    cluster: "tls_inspect_internal",
    upgrade_configs: connectUpgrade,
  };
  if (anyUpgrades) genericRoute.idle_timeout = "14400s";
  routes.push({
    match: { connect_matcher: {} },
    route: genericRoute,
    typed_per_filter_config: extAuthzDisabledPerRoute(),
  });
  routes.push({
    match: {
      prefix: "/",
      headers: [
        { name: ":authority", string_match: { exact: p.harnessAuthority } },
      ],
    },
    route: { cluster: "harness_http", timeout: "0s" },
    typed_per_filter_config: extAuthzDisabledPerRoute(),
  });
  const fallthroughRoute: Ev = {
    match: { prefix: "/" },
    route: { cluster: "dynamic_forward_proxy_http", timeout: "0s" },
  };
  if (p.otel.traces) {
    fallthroughRoute.request_headers_to_remove = ["traceparent", "tracestate"];
  }
  routes.push(fallthroughRoute);
  return routes;
}

function buildInternalListener(p: EnvoyBootstrapParams): Ev {
  const chains: Ev[] = p.chains.map((c) => buildTerminatingChain(p, c));
  if (p.telemetry) chains.push(buildCollectorChain(p));
  chains.push(buildL4CatchAllChain(p));
  return {
    name: "tls_inspect_internal",
    internal_listener: {},
    listener_filters: [
      {
        name: "envoy.filters.listener.tls_inspector",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector",
        },
      },
    ],
    filter_chains: chains,
  };
}

function buildTerminatingChain(p: EnvoyBootstrapParams, c: EnvoyHostChain): Ev {
  const commonTls: Ev = {
    tls_certificates: [
      {
        certificate_chain: { filename: `${p.leafTlsDir}/tls.crt` },
        private_key: { filename: `${p.leafTlsDir}/tls.key` },
      },
    ],
  };
  if (c.http2) commonTls.alpn_protocols = ["h2", "http/1.1"];

  const hcm: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
    stat_prefix: `terminate_${c.chainId}`,
    http_filters: buildChainHttpFilters(p, c),
    route_config: {
      name: `forward_${c.chainId}`,
      virtual_hosts: [
        { name: "default", domains: ["*"], routes: buildChainForwardRoutes(c) },
      ],
    },
  };
  if (c.upgrades) {
    hcm.upgrade_configs = [
      { upgrade_type: "websocket" },
      { upgrade_type: "spdy/3.1" },
    ];
  }
  if (p.otel.traces && !hasQueryParamCredential(c)) {
    hcm.tracing = otelTracing(p, 1);
  }
  if (p.otel.accessLogs) {
    hcm.access_log = hcmAccessLog(
      p,
      `terminate_${c.chainId}`,
      `terminate_${c.chainId}`,
      "chains",
    );
  }

  return {
    name: `terminate_${c.chainId}`,
    filter_chain_match: { server_names: [c.host] },
    transport_socket: {
      name: "envoy.transport_sockets.tls",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
        common_tls_context: commonTls,
      },
    },
    filters: [
      {
        name: "envoy.filters.network.http_connection_manager",
        typed_config: hcm,
      },
    ],
  };
}

function buildChainHttpFilters(
  p: EnvoyBootstrapParams,
  c: EnvoyHostChain,
): Ev[] {
  const filters: Ev[] = [extAuthzHttpFilter(p)];
  for (const cred of c.credentials) {
    filters.push({
      name: "envoy.filters.http.credential_injector",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector",
        overwrite: true,
        credential: {
          name: "envoy.http.injected_credentials.generic",
          typed_config: {
            "@type":
              "type.googleapis.com/envoy.extensions.http.injected_credentials.generic.v3.Generic",
            credential: {
              name: p.credentialSdsName,
              sds_config: {
                path_config_source: {
                  path: `${p.credentialsRoot}/${cred.volumeName}/${cred.sdsFileKey}`,
                  watched_directory: {
                    path: `${p.credentialsRoot}/${cred.volumeName}`,
                  },
                },
              },
            },
            header: cred.headerName,
          },
        },
      },
    });
    if (cred.queryParamName) {
      filters.push({
        name: "envoy.filters.http.lua",
        typed_config: {
          "@type": "type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua",
          default_source_code: {
            inline_string: luaQueryParamScript(
              cred.headerName,
              cred.queryParamName,
            ),
          },
        },
      });
    }
  }
  filters.push(dynamicForwardProxyHttpFilter(), routerHttpFilter());
  return filters;
}

function buildChainForwardRoutes(c: EnvoyHostChain): Ev[] {
  const routes: Ev[] = (c.pathRewrites ?? []).map((r) => {
    const route = buildChainRouteAction(c);
    route.prefix_rewrite = r.replacement;
    return { match: { prefix: r.prefix }, route };
  });
  routes.push({ match: { prefix: "/" }, route: buildChainRouteAction(c) });
  return routes;
}

function buildChainRouteAction(c: EnvoyHostChain): Ev {
  const route: Ev = { timeout: "0s" };
  if (credentialed(c)) {
    route.cluster = c.upstreamCluster;
    route.host_rewrite_literal = hostRewrite(c);
  } else {
    route.cluster = "dynamic_forward_proxy_https";
  }
  if (c.upgrades) route.idle_timeout = "14400s";
  return route;
}

function buildCollectorChain(p: EnvoyBootstrapParams): Ev {
  const attributionId = p.attributionId || p.agentId;
  const headersToAdd: Ev[] = [
    {
      header: { key: "x-platform-agent-id", value: attributionId },
      append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
    },
  ];
  const route: Ev = {
    match: { prefix: "/" },
    route: {
      cluster: "otel_collector",
      host_rewrite_literal: p.telemetryCollectorHost,
      timeout: "0s",
    },
  };
  if (attributionOverridden(p)) {
    headersToAdd.push({
      header: { key: "x-platform-invocation-id", value: p.agentId },
      append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
    });
  } else {
    route.request_headers_to_remove = ["x-platform-invocation-id"];
  }
  route.request_headers_to_add = headersToAdd;
  const hcm: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
    stat_prefix: "terminate_otel_collector",
    http_filters: [routerHttpFilter()],
    route_config: {
      name: "forward_otel_collector",
      virtual_hosts: [{ name: "default", domains: ["*"], routes: [route] }],
    },
  };
  if (p.otel.accessLogs) hcm.access_log = collectorAccessLog(p);
  return {
    name: "terminate_otel_collector",
    filter_chain_match: { server_names: [p.telemetryCollectorHost] },
    transport_socket: {
      name: "envoy.transport_sockets.tls",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
        common_tls_context: {
          tls_certificates: [
            {
              certificate_chain: { filename: `${p.leafTlsDir}/tls.crt` },
              private_key: { filename: `${p.leafTlsDir}/tls.key` },
            },
          ],
        },
      },
    },
    filters: [
      {
        name: "envoy.filters.network.http_connection_manager",
        typed_config: hcm,
      },
    ],
  };
}

function buildL4CatchAllChain(p: EnvoyBootstrapParams): Ev {
  const tcpProxy: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy",
    stat_prefix: "l4_authz_forward",
    cluster: "dynamic_forward_proxy_tcp",
  };
  if (p.otel.accessLogs) tcpProxy.access_log = l4AccessLog(p);
  return {
    name: "l4_authz_passthrough",
    filters: [
      {
        name: "envoy.filters.network.ext_authz",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.network.ext_authz.v3.ExtAuthz",
          stat_prefix: "l4_authz",
          transport_api_version: "V3",
          failure_mode_allow: false,
          include_tls_session: true,
          grpc_service: {
            envoy_grpc: {
              cluster_name: "ext_authz_cluster",
              authority: p.extAuthzAuthority,
            },
            timeout: `${p.extAuthzTimeoutSeconds}s`,
          },
        },
      },
      {
        name: "envoy.filters.network.sni_dynamic_forward_proxy",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.network.sni_dynamic_forward_proxy.v3.FilterConfig",
          port_value: 443,
          dns_cache_config: dnsCacheConfig(),
        },
      },
      { name: "envoy.filters.network.tcp_proxy", typed_config: tcpProxy },
    ],
  };
}

function buildClusters(p: EnvoyBootstrapParams): Ev[] {
  const clusters: Ev[] = [
    {
      name: "tls_inspect_internal",
      connect_timeout: "1s",
      load_assignment: {
        cluster_name: "tls_inspect_internal",
        endpoints: [
          {
            lb_endpoints: [
              {
                endpoint: {
                  address: {
                    envoy_internal_address: {
                      server_listener_name: "tls_inspect_internal",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    },
    dynamicForwardProxyCluster("dynamic_forward_proxy_https", true),
    dynamicForwardProxyCluster("dynamic_forward_proxy_tcp", false),
    dynamicForwardProxyCluster("dynamic_forward_proxy_http", false),
    pipeCluster("harness_passthrough", p.harnessSocketPath),
    pipeCluster("harness_http", p.harnessSocketPath),
  ];
  if (p.objectStoreAuthority) {
    clusters.push(
      pinnedTcpCluster(
        "objectstore_passthrough",
        p.objectStoreHost!,
        p.objectStorePort!,
      ),
    );
  }
  for (const c of p.chains) {
    if (credentialed(c)) clusters.push(buildUpstreamCluster(c));
  }
  if (p.telemetry) {
    clusters.push(
      pinnedTcpCluster(
        "otel_collector",
        p.telemetryCollectorHost!,
        p.telemetryCollectorPort!,
      ),
    );
  }
  clusters.push({
    name: "ext_authz_cluster",
    connect_timeout: "1s",
    lb_policy: "ROUND_ROBIN",
    typed_extension_protocol_options: {
      "envoy.extensions.upstreams.http.v3.HttpProtocolOptions": {
        "@type":
          "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
        explicit_http_config: { http2_protocol_options: {} },
      },
    },
    load_assignment: pipeLoadAssignment(
      "ext_authz_cluster",
      p.extAuthzSocketPath,
    ),
  });
  if (p.otel.collector) clusters.push(buildOTelExportCluster(p));
  return clusters;
}

function dynamicForwardProxyCluster(name: string, withTls: boolean): Ev {
  const c: Ev = {
    name,
    connect_timeout: "5s",
    lb_policy: "CLUSTER_PROVIDED",
    cluster_type: {
      name: "envoy.clusters.dynamic_forward_proxy",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig",
        dns_cache_config: dnsCacheConfig(),
      },
    },
  };
  if (withTls) {
    c.transport_socket = {
      name: "envoy.transport_sockets.tls",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
        common_tls_context: {
          validation_context: {
            trusted_ca: { filename: "/etc/ssl/certs/ca-certificates.crt" },
          },
        },
      },
    };
  }
  return c;
}

function pinnedTcpCluster(name: string, host: string, port: number): Ev {
  return {
    name,
    connect_timeout: "5s",
    type: "STRICT_DNS",
    dns_lookup_family: "V4_PREFERRED",
    lb_policy: "ROUND_ROBIN",
    load_assignment: socketLoadAssignment(name, host, port),
  };
}

/** A local service reached over a unix socket rather than a cluster IP. */
function pipeCluster(name: string, path: string): Ev {
  return {
    name,
    connect_timeout: "5s",
    type: "STATIC",
    lb_policy: "ROUND_ROBIN",
    load_assignment: pipeLoadAssignment(name, path),
  };
}

function buildUpstreamCluster(c: EnvoyHostChain): Ev {
  const trustedCa = c.upstreamCaFile || "/etc/ssl/certs/ca-certificates.crt";
  const cluster: Ev = {
    name: c.upstreamCluster,
    connect_timeout: "5s",
    type: "STRICT_DNS",
    dns_lookup_family: "V4_PREFERRED",
    lb_policy: "ROUND_ROBIN",
    load_assignment: socketLoadAssignment(
      c.upstreamCluster,
      c.host,
      upstreamPortValue(c),
    ),
    transport_socket: {
      name: "envoy.transport_sockets.tls",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
        sni: c.host,
        auto_host_sni: false,
        common_tls_context: {
          validation_context: {
            trusted_ca: { filename: trustedCa },
            match_typed_subject_alt_names: [
              { san_type: "DNS", matcher: { exact: c.host } },
            ],
          },
        },
      },
    },
  };
  if (c.http2) {
    cluster.typed_extension_protocol_options = {
      "envoy.extensions.upstreams.http.v3.HttpProtocolOptions": {
        "@type":
          "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
        use_downstream_protocol_config: {
          http_protocol_options: {},
          http2_protocol_options: {},
        },
      },
    };
  }
  return cluster;
}

function buildOTelExportCluster(p: EnvoyBootstrapParams): Ev {
  const cluster: Ev = {
    name: "otel_export",
    connect_timeout: "5s",
    type: "STRICT_DNS",
    dns_lookup_family: "V4_PREFERRED",
    lb_policy: "ROUND_ROBIN",
    load_assignment: socketLoadAssignment(
      "otel_export",
      p.otel.collectorHost,
      p.otel.collectorPort,
    ),
  };
  if (p.otel.grpc) {
    cluster.typed_extension_protocol_options = {
      "envoy.extensions.upstreams.http.v3.HttpProtocolOptions": {
        "@type":
          "type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions",
        explicit_http_config: { http2_protocol_options: {} },
      },
    };
  }
  if (p.otel.secure) {
    cluster.transport_socket = {
      name: "envoy.transport_sockets.tls",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext",
        sni: p.otel.collectorHost,
        common_tls_context: {
          validation_context: {
            trusted_ca: { filename: "/etc/ssl/certs/ca-certificates.crt" },
          },
        },
      },
    };
  }
  return cluster;
}

function socketLoadAssignment(
  clusterName: string,
  host: string,
  port: number,
): Ev {
  return {
    cluster_name: clusterName,
    endpoints: [
      {
        lb_endpoints: [
          {
            endpoint: {
              address: { socket_address: { address: host, port_value: port } },
            },
          },
        ],
      },
    ],
  };
}

function pipeLoadAssignment(clusterName: string, path: string): Ev {
  return {
    cluster_name: clusterName,
    endpoints: [
      {
        lb_endpoints: [
          { endpoint: { address: { pipe: { path } } } },
        ],
      },
    ],
  };
}

function extAuthzHttpFilter(p: EnvoyBootstrapParams): Ev {
  return {
    name: "envoy.filters.http.ext_authz",
    typed_config: {
      "@type":
        "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz",
      transport_api_version: "V3",
      failure_mode_allow: false,
      grpc_service: {
        envoy_grpc: {
          cluster_name: "ext_authz_cluster",
          authority: p.extAuthzAuthority,
        },
        timeout: `${p.extAuthzTimeoutSeconds}s`,
      },
    },
  };
}

function extAuthzDisabledPerRoute(): Ev {
  return {
    "envoy.filters.http.ext_authz": {
      "@type":
        "type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute",
      disabled: true,
    },
  };
}

function dynamicForwardProxyHttpFilter(): Ev {
  return {
    name: "envoy.filters.http.dynamic_forward_proxy",
    typed_config: {
      "@type":
        "type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig",
      dns_cache_config: dnsCacheConfig(),
    },
  };
}

function routerHttpFilter(): Ev {
  return {
    name: "envoy.filters.http.router",
    typed_config: {
      "@type": "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router",
    },
  };
}

function dnsCacheConfig(): Ev {
  return { name: "dns_cache", dns_lookup_family: "V4_PREFERRED" };
}

function otelTracing(p: EnvoyBootstrapParams, maxPathTagLength: number): Ev {
  const tracerTc: Ev = {
    "@type": "type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig",
    service_name: p.otel.serviceName,
    resource_detectors: [
      {
        name: "envoy.tracers.opentelemetry.resource_detectors.environment",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.tracers.opentelemetry.resource_detectors.v3.EnvironmentResourceDetectorConfig",
        },
      },
    ],
  };
  if (p.otel.grpc) tracerTc.grpc_service = otlpGrpcService();
  else tracerTc.http_service = otlpHttpService(p.otel.tracesUri);
  return {
    spawn_upstream_span: false,
    max_path_tag_length: maxPathTagLength,
    random_sampling: { value: p.otel.samplingPercent },
    provider: {
      name: "envoy.tracers.opentelemetry",
      typed_config: tracerTc,
    },
  };
}

const otlpGrpcService = (): Ev => ({
  envoy_grpc: { cluster_name: "otel_export" },
  timeout: "5s",
});

const otlpHttpService = (uri: string): Ev => ({
  http_uri: { uri, cluster: "otel_export", timeout: "5s" },
});

const reqWithoutQueryFormatters = (): Ev[] => [
  {
    name: "envoy.formatter.req_without_query",
    typed_config: {
      "@type":
        "type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery",
    },
  },
];

const alAttr = (key: string, value: string): Ev => ({
  key,
  value: { string_value: value },
});

const otlpResourceAttrs = (serviceName: string, agentId: string): Ev => ({
  values: [
    alAttr("service.name", serviceName),
    alAttr("platform.gateway.id", agentId),
  ],
});

function hcmAccessLog(
  p: EnvoyBootstrapParams,
  fileChain: string,
  otlpChain: string,
  statPrefix: string,
): Ev[] {
  const fileJson: Ev = {
    service_name: p.otel.serviceName,
    agent_id: p.otel.agentId,
    start_time: "%START_TIME%",
    method: "%REQ(:METHOD)%",
    authority: "%REQ(:AUTHORITY)%",
    path: "%REQ_WITHOUT_QUERY(:PATH)%",
    response_code: "%RESPONSE_CODE%",
    response_flags: "%RESPONSE_FLAGS%",
    duration_ms: "%DURATION%",
    upstream_host: "%UPSTREAM_HOST%",
    bytes_received: "%BYTES_RECEIVED%",
    bytes_sent: "%BYTES_SENT%",
    x_request_id: "%REQ(X-REQUEST-ID)%",
  };
  if (fileChain) fileJson.chain = fileChain;
  const otlpTc: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
    stat_prefix: statPrefix,
    disable_builtin_labels: true,
    formatters: reqWithoutQueryFormatters(),
    resource_attributes: otlpResourceAttrs(p.otel.serviceName, p.otel.agentId),
    body: {
      string_value: "%REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE%",
    },
    attributes: {
      values: [
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
      ],
    },
  };
  if (p.otel.grpc) otlpTc.grpc_service = otlpGrpcService();
  else otlpTc.http_service = otlpHttpService(p.otel.logsUri);
  return [
    {
      name: "envoy.access_loggers.file",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
        path: "/dev/stdout",
        log_format: {
          formatters: reqWithoutQueryFormatters(),
          json_format: fileJson,
        },
      },
    },
    { name: "envoy.access_loggers.open_telemetry", typed_config: otlpTc },
  ];
}

function collectorAccessLog(p: EnvoyBootstrapParams): Ev[] {
  const errFilter: Ev = {
    or_filter: {
      filters: [
        {
          status_code_filter: {
            comparison: {
              op: "GE",
              value: {
                default_value: 400,
                runtime_key: "access_log.otel_collector.min_status",
              },
            },
          },
        },
        { response_flag_filter: {} },
      ],
    },
  };
  const otlpTc: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
    stat_prefix: "otel_transit",
    disable_builtin_labels: true,
    formatters: reqWithoutQueryFormatters(),
    resource_attributes: otlpResourceAttrs(p.otel.serviceName, p.otel.agentId),
    body: {
      string_value:
        "telemetry delivery failure %REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE% %RESPONSE_FLAGS%",
    },
    attributes: {
      values: [
        alAttr("chain", "terminate_otel_collector"),
        alAttr("method", "%REQ(:METHOD)%"),
        alAttr("path", "%REQ_WITHOUT_QUERY(:PATH)%"),
        alAttr("response_code", "%RESPONSE_CODE%"),
        alAttr("response_flags", "%RESPONSE_FLAGS%"),
        alAttr("duration_ms", "%DURATION%"),
        alAttr("upstream_host", "%UPSTREAM_HOST%"),
      ],
    },
  };
  if (p.otel.grpc) otlpTc.grpc_service = otlpGrpcService();
  else otlpTc.http_service = otlpHttpService(p.otel.logsUri);
  return [
    {
      name: "envoy.access_loggers.file",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
        path: "/dev/stdout",
        log_format: {
          formatters: reqWithoutQueryFormatters(),
          json_format: {
            service_name: p.otel.serviceName,
            agent_id: p.otel.agentId,
            chain: "terminate_otel_collector",
            start_time: "%START_TIME%",
            method: "%REQ(:METHOD)%",
            path: "%REQ_WITHOUT_QUERY(:PATH)%",
            response_code: "%RESPONSE_CODE%",
            response_flags: "%RESPONSE_FLAGS%",
            duration_ms: "%DURATION%",
            upstream_host: "%UPSTREAM_HOST%",
          },
        },
      },
      filter: errFilter,
    },
    {
      name: "envoy.access_loggers.open_telemetry",
      typed_config: otlpTc,
      filter: errFilter,
    },
  ];
}

function l4AccessLog(p: EnvoyBootstrapParams): Ev[] {
  const otlpTc: Ev = {
    "@type":
      "type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig",
    stat_prefix: "l4",
    disable_builtin_labels: true,
    resource_attributes: otlpResourceAttrs(p.otel.serviceName, p.otel.agentId),
    body: { string_value: "SNI %REQUESTED_SERVER_NAME%" },
    attributes: {
      values: [
        alAttr("chain", "l4_authz_passthrough"),
        alAttr("requested_server_name", "%REQUESTED_SERVER_NAME%"),
        alAttr("upstream_host", "%UPSTREAM_HOST%"),
        alAttr("response_flags", "%RESPONSE_FLAGS%"),
        alAttr("duration_ms", "%DURATION%"),
        alAttr("bytes_received", "%BYTES_RECEIVED%"),
        alAttr("bytes_sent", "%BYTES_SENT%"),
      ],
    },
  };
  if (p.otel.grpc) otlpTc.grpc_service = otlpGrpcService();
  else otlpTc.http_service = otlpHttpService(p.otel.logsUri);
  return [
    {
      name: "envoy.access_loggers.file",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog",
        path: "/dev/stdout",
        log_format: {
          json_format: {
            service_name: p.otel.serviceName,
            agent_id: p.otel.agentId,
            chain: "l4_authz_passthrough",
            start_time: "%START_TIME%",
            requested_server_name: "%REQUESTED_SERVER_NAME%",
            upstream_host: "%UPSTREAM_HOST%",
            response_flags: "%RESPONSE_FLAGS%",
            duration_ms: "%DURATION%",
            bytes_received: "%BYTES_RECEIVED%",
            bytes_sent: "%BYTES_SENT%",
          },
        },
      },
    },
    { name: "envoy.access_loggers.open_telemetry", typed_config: otlpTc },
  ];
}

function luaQueryParamScript(header: string, param: string): string {
  return `local HEADER = ${JSON.stringify(header)}
local PARAM  = ${JSON.stringify(param)}
-- Percent-encode every byte outside RFC 3986 unreserved. Without this, a
-- credential containing & or = would break out of its query parameter — the
-- splitter below frames on those bytes literally. We encode the credential
-- value but not PARAM (PARAM is api-server-validated against the URL-safe
-- charset, so it's already safe).
local function urlencode(s)
  return (string.gsub(s, "[^A-Za-z0-9%-_.~]", function(c)
    return string.format("%%%02X", string.byte(c))
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
`;
}
