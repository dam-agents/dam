// TEST_OVERVIEW: the gateway config is what actually enforces credential isolation, so these check the properties a wrong render would break silently: one filter chain per host, no credential injected twice into one header, ext_authz on everything that is not platform-internal, and the control-plane hops on unix sockets rather than a network address.
import { describe, expect, it } from "vitest";
import {
  buildChains,
  filterByGrants,
  sdsFileKeyForHost,
  type CredentialSecret,
} from "../../modules/sandboxes/domain/chains.js";
import { buildEnvoyBootstrap } from "../../modules/sandboxes/domain/envoy-bootstrap.js";

const CREDENTIALS_ROOT = "/var/lib/dam/agents/a1/gateway/credentials";

function connectionSecret(
  name: string,
  connectionId: string,
  hosts: unknown[],
  extraFields: string[] = [],
): CredentialSecret {
  return {
    name,
    labels: {
      "agent-platform.ai/secret-type": "connection",
      "agent-platform.ai/connection": connectionId,
    },
    annotations: {
      "agent-platform.ai/injection-hosts": JSON.stringify(hosts),
    },
    fieldNames: [
      ...hosts.flatMap((h) =>
        (h as { host?: string }).host
          ? [sdsFileKeyForHost((h as { host: string }).host)]
          : [],
      ),
      ...extraFields,
    ],
  };
}

describe("grant filtering", () => {
  const secrets: CredentialSecret[] = [
    connectionSecret("conn-a", "conn-1", [{ host: "api.example.com" }]),
    connectionSecret("conn-b", "conn-2", [{ host: "other.example.com" }]),
    {
      name: "platform-cred-tok1",
      labels: {},
      annotations: {},
      fieldNames: ["sds.yaml"],
    },
    {
      name: "allow-1",
      labels: { "agent-platform.ai/secret-type": "allow-only" },
      annotations: { "agent-platform.ai/host-pattern": "cdn.example.com" },
      fieldNames: [],
    },
  ];

  // TEST_SCENARIO: an ungranted credential reaching the gateway is the failure this whole model exists to prevent — it would be injected into the agent's traffic without the owner ever granting it.
  it("keeps only granted connections and secrets", () => {
    const kept = filterByGrants(secrets, ["tok1"], ["conn-1"]).map((s) => s.name);
    expect(kept).toEqual(["conn-a", "platform-cred-tok1", "allow-1"]);
  });

  it("keeps allow-only entries, which carry no credential to leak", () => {
    expect(filterByGrants(secrets, [], []).map((s) => s.name)).toEqual(["allow-1"]);
  });
});

describe("chains", () => {
  it("merges two credentials for one host into a single chain", () => {
    const { chains } = buildChains(
      [
        connectionSecret("first", "c1", [
          { host: "api.example.com", headerName: "Authorization" },
        ]),
        connectionSecret("second", "c2", [
          { host: "api.example.com", headerName: "X-Extra" },
        ]),
      ],
      [],
      CREDENTIALS_ROOT,
    );
    expect(chains).toHaveLength(1);
    expect(chains[0]!.credentials.map((c) => c.headerName)).toEqual([
      "Authorization",
      "X-Extra",
    ]);
  });

  // TEST_SCENARIO: two credentials on one header make credential_injector clobber one with the other, and which one wins is not observable from the config — so the second is dropped loudly instead.
  it("drops a second credential on the same header and says so", () => {
    const { chains, warnings } = buildChains(
      [
        connectionSecret("first", "c1", [{ host: "api.example.com" }]),
        connectionSecret("second", "c2", [{ host: "api.example.com" }]),
      ],
      [],
      CREDENTIALS_ROOT,
    );
    expect(chains[0]!.credentials).toHaveLength(1);
    expect(warnings.map((w) => w.message)).toContain(
      "duplicate injection header on host; later credential skipped to avoid credential_injector clobber",
    );
  });

  it("renders a host allow-only when its SDS field is missing", () => {
    const secret = connectionSecret("conn", "c1", [{ host: "api.example.com" }]);
    secret.fieldNames = [];
    const { chains, warnings } = buildChains([secret], [], CREDENTIALS_ROOT);
    expect(chains[0]!.credentials).toEqual([]);
    expect(warnings[0]!.message).toContain("missing its SDS field");
  });

  it("ignores a path rewrite that is not anchored at both ends", () => {
    const { chains, warnings } = buildChains(
      [
        connectionSecret("conn", "c1", [
          {
            host: "api.example.com",
            pathRewrites: [
              { prefix: "/v1/", replacement: "/" },
              { prefix: "/bad", replacement: "/" },
            ],
          },
        ]),
      ],
      [],
      CREDENTIALS_ROOT,
    );
    expect(chains[0]!.pathRewrites).toEqual([{ prefix: "/v1/", replacement: "/" }]);
    expect(warnings.map((w) => w.message)).toContain(
      "invalid path rewrite in injection-hosts; ignoring",
    );
  });

  it("refuses a caKey that could climb out of the credential directory", () => {
    const secret = connectionSecret(
      "conn",
      "c1",
      [{ host: "api.example.com", caKey: "../../etc/ca.crt" }],
      ["../../etc/ca.crt"],
    );
    const { chains, warnings } = buildChains([secret], [], CREDENTIALS_ROOT);
    expect(chains[0]!.upstreamCaFile).toBeUndefined();
    expect(warnings.map((w) => w.message)).toContain(
      "invalid caKey in injection-hosts; ignoring",
    );
  });

  it("adds an uncredentialed chain per promoted L7 host", () => {
    const { chains } = buildChains([], ["l7.example.com"], CREDENTIALS_ROOT);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.host).toBe("l7.example.com");
    expect(chains[0]!.credentials).toEqual([]);
  });
});

describe("bootstrap", () => {
  const base = {
    listenAddress: "100.64.0.1",
    port: 3128,
    chains: buildChains(
      [connectionSecret("conn", "c1", [{ host: "api.example.com" }])],
      [],
      CREDENTIALS_ROOT,
    ).chains,
    credentialsRoot: CREDENTIALS_ROOT,
    credentialSdsName: "credential",
    leafTlsDir: "/var/lib/dam/agents/a1/gateway/tls",
    harnessAuthority: "harness.platform:4001",
    harnessSocketPath: "/run/dam/harness/a1.sock",
    healthPath: "/__platform_healthz",
    extAuthzSocketPath: "/run/dam/extauthz/a1.sock",
    extAuthzAuthority: "a1",
    extAuthzTimeoutSeconds: 90,
    telemetry: false,
    agentId: "a1",
    otel: {
      traces: false,
      metrics: false,
      accessLogs: false,
      collector: false,
      grpc: false,
      secure: false,
      collectorHost: "",
      collectorPort: 0,
      tracesUri: "",
      logsUri: "",
      serviceName: "platform-agent-gateway",
      agentId: "a1",
      samplingPercent: 0,
    },
  };

  const doc = buildEnvoyBootstrap(base) as {
    static_resources: { listeners: Ev[]; clusters: Ev[] };
  };
  type Ev = Record<string, any>;

  it("binds only the host end of the agent's own link", () => {
    expect(doc.static_resources.listeners[0]!.address).toEqual({
      socket_address: { address: "100.64.0.1", port_value: 3128 },
    });
  });

  // TEST_SCENARIO: the api-server hops carry no bearer, so a TCP address would let any process on the node speak for any agent. The socket path is the identity.
  it("reaches the harness and ext_authz over this agent's unix sockets", () => {
    const byName = new Map(
      doc.static_resources.clusters.map((c) => [c.name as string, c]),
    );
    for (const name of ["harness_passthrough", "harness_http"]) {
      expect(
        byName.get(name)!.load_assignment.endpoints[0].lb_endpoints[0].endpoint
          .address,
      ).toEqual({ pipe: { path: "/run/dam/harness/a1.sock" } });
    }
    expect(
      byName.get("ext_authz_cluster")!.load_assignment.endpoints[0]
        .lb_endpoints[0].endpoint.address,
    ).toEqual({ pipe: { path: "/run/dam/extauthz/a1.sock" } });
  });

  it("gates ordinary egress on ext_authz but never the harness path", () => {
    const routes =
      doc.static_resources.listeners[0]!.filter_chains[0].filters[0]
        .typed_config.route_config.virtual_hosts[0].routes;
    const harnessRoute = routes.find(
      (r: Ev) => r.route?.cluster === "harness_passthrough",
    );
    expect(harnessRoute.typed_per_filter_config).toHaveProperty(
      "envoy.filters.http.ext_authz",
    );
    const fallthrough = routes.at(-1);
    expect(fallthrough.typed_per_filter_config).toBeUndefined();
  });

  it("terminates each chain's host with the agent's own leaf", () => {
    const internal = doc.static_resources.listeners[1]!;
    const chain = internal.filter_chains[0];
    expect(chain.filter_chain_match.server_names).toEqual(["api.example.com"]);
    expect(
      chain.transport_socket.typed_config.common_tls_context.tls_certificates[0]
        .certificate_chain.filename,
    ).toBe("/var/lib/dam/agents/a1/gateway/tls/tls.crt");
  });

  // TEST_SCENARIO: anything not matched by a terminating chain still has to be authorized, or an unknown SNI becomes an open tunnel.
  it("keeps an ext_authz-gated L4 catch-all as the last chain", () => {
    const internal = doc.static_resources.listeners[1]!;
    const last = internal.filter_chains.at(-1);
    expect(last.name).toBe("l4_authz_passthrough");
    expect(last.filters[0].name).toBe("envoy.filters.network.ext_authz");
    expect(last.filters[0].typed_config.failure_mode_allow).toBe(false);
  });
});
