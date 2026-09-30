/**
 * TEST_OVERVIEW: An agent may hold several Connections to one service, each with
 * its own credential. The gateway tells them apart by the path the agent asks
 * for, so every MCP server entry a Connection contributes is delivered under a
 * per-Connection path on the real host, and by the token value a client sends,
 * so every credential placeholder a Connection hands the agent is its own. The
 * gateway strips the path again before the request leaves, so the upstream sees
 * the address it published.
 */
import { describe, it, expect } from "vitest";
import type { Contribution } from "api-server-api";
import {
  applyConnectionEgressAddressing,
  connectionEgressPathPrefix,
  connectionEgressPlaceholder,
  stripConnectionEgressPrefix,
} from "api-server-api";

function mcpEntry(url: string): Contribution {
  return { kind: "mcp-entry", name: "workspace", url };
}

type EgressInject = Extract<Contribution, { kind: "egress-inject" }>;

function inject(host: string, extra: Partial<EgressInject> = {}): Contribution {
  return {
    kind: "egress-inject",
    host,
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
    ...extra,
  };
}

function urlOf(contributions: Contribution[]): string {
  const entry = contributions.find((c) => c.kind === "mcp-entry");
  if (entry?.kind !== "mcp-entry") throw new Error("no mcp-entry");
  return entry.url;
}

describe("applyConnectionEgressAddressing", () => {
  /** TEST_SCENARIO: The Slack case. The entry points at the host the gateway injects
   * on, so it is delivered under this Connection's own path. */
  it("prefixes an MCP entry whose host this connection injects on", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("mcp.slack.com"),
      mcpEntry("https://mcp.slack.com/mcp"),
    ]);
    expect(urlOf(out)).toBe(
      "https://mcp.slack.com/__platform_conn/conn-aaa/mcp",
    );
  });

  /** TEST_SCENARIO: Two Connections to one service must reach two different
   * accounts, so they must not be delivered the same address. */
  it("gives two connections on one host two different addresses", () => {
    const contributions = [
      inject("mcp.slack.com"),
      mcpEntry("https://mcp.slack.com/mcp"),
    ];
    const first = urlOf(
      applyConnectionEgressAddressing("conn-aaa", contributions),
    );
    const second = urlOf(
      applyConnectionEgressAddressing("conn-bbb", contributions),
    );
    expect(first).not.toBe(second);
  });

  /** TEST_SCENARIO: The host stays the real one, so network rules, approvals and
   * logs keep describing the real destination. */
  it("changes only the path, never the host or the scheme", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("mcp.slack.com"),
      mcpEntry("https://mcp.slack.com/mcp?tier=a#frag"),
    ]);
    const url = new URL(urlOf(out));
    expect(url.host).toBe("mcp.slack.com");
    expect(url.protocol).toBe("https:");
    expect(url.search).toBe("?tier=a");
    expect(url.hash).toBe("#frag");
    expect(url.pathname).toBe(`${connectionEgressPathPrefix("conn-aaa")}/mcp`);
  });

  /** TEST_SCENARIO: An entry the gateway holds no credential for has no addressed
   * route, so prefixing it would send the agent at a path nothing serves. */
  it("leaves an entry on an uninjected host alone", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("mcp.slack.com"),
      mcpEntry("https://elsewhere.example.com/mcp"),
    ]);
    expect(urlOf(out)).toBe("https://elsewhere.example.com/mcp");
  });

  /** TEST_SCENARIO: The gateway gives a path-scoped injection an addressed route
   * only under its own scope, so prefixing an entry that sits outside that scope
   * would name a path nothing serves. Such a connection keeps the plain address,
   * which its scoped route still injects on. */
  it("leaves an entry alone when the injection is scoped to a path", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("www.googleapis.com", { pathPattern: "/gmail/*" }),
      mcpEntry("https://www.googleapis.com/gmail/mcp"),
    ]);
    expect(urlOf(out)).toBe("https://www.googleapis.com/gmail/mcp");
  });

  /** TEST_SCENARIO: A connection with no credential of its own — an allow-only MCP
   * server — is reached on the catch-all route, unprefixed. */
  it("returns the contributions untouched when nothing is injected", () => {
    const contributions = [mcpEntry("https://mcp.example.com/mcp")];
    expect(applyConnectionEgressAddressing("conn-aaa", contributions)).toBe(
      contributions,
    );
  });

  /** TEST_SCENARIO: An injection host may carry a port; the entry is matched on the
   * hostname so the port does not hide the match. */
  it("matches a host declared with a port", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("api.internal:8443", { port: 8443 }),
      mcpEntry("https://api.internal:8443/mcp"),
    ]);
    expect(urlOf(out)).toBe(
      "https://api.internal:8443/__platform_conn/conn-aaa/mcp",
    );
  });

  /** TEST_SCENARIO: A client that takes a token rather than a URL, gh through
   * GH_TOKEN, sends whatever the env holds where the real token goes. That value
   * is the Connection's other address, so the inert placeholder becomes the
   * per-Connection one, in env and in the config files that carry it alike. */
  it("carries the connection's token placeholder into credential env and files", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("api.github.com"),
      { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
      {
        kind: "file",
        path: "$HOME/.config/gh/hosts.yml",
        format: "yaml",
        mergeMode: "key-targeted",
        content: {
          "ghe.acme.com": {
            oauth_token: "dummy-placeholder",
            git_protocol: "https",
          },
        },
      },
    ]);
    expect(out).toContainEqual({
      kind: "env",
      name: "GH_TOKEN",
      placeholder: connectionEgressPlaceholder("conn-aaa"),
    });
    expect(out).toContainEqual(
      expect.objectContaining({
        kind: "file",
        content: {
          "ghe.acme.com": {
            oauth_token: "platform:conn:conn-aaa",
            git_protocol: "https",
          },
        },
      }),
    );
  });

  /** TEST_SCENARIO: Only the credential placeholder is an address. A literal
   * env value and the gateway-side injection reach their rails unchanged. */
  it("leaves non-credential env and the injections untouched", () => {
    const host: Contribution = {
      kind: "env",
      name: "GH_HOST",
      placeholder: "ghe.acme.com",
    };
    const injection = inject("ghe.acme.com");
    const out = applyConnectionEgressAddressing("conn-aaa", [injection, host]);
    expect(out).toContainEqual(host);
    expect(out).toContainEqual(injection);
  });

  /** TEST_SCENARIO: An MCP entry may carry the placeholder inside a header the
   * MCP client sends verbatim. That header is then the second carrier of the
   * address, so a path-scoped entry the platform cannot prefix still names its
   * Connection. */
  it("carries the placeholder into an MCP entry's headers", () => {
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("mcp.slack.com"),
      {
        kind: "mcp-entry",
        name: "slack",
        url: "https://mcp.slack.com/mcp",
        headers: { Authorization: "Bearer dummy-placeholder" },
      },
    ]);
    const entry = out.find((c) => c.kind === "mcp-entry");
    expect(entry?.kind === "mcp-entry" && entry.headers).toEqual({
      Authorization: "Bearer platform:conn:conn-aaa",
    });
  });
});

describe("stripConnectionEgressPrefix", () => {
  /** TEST_SCENARIO: The gate matches the request against the agent's egress rules.
   * Those rules name the paths the service publishes, so the address the agent
   * used to pick an account must not change which rule matches. */
  it("gives back the path the upstream will be asked for", () => {
    expect(stripConnectionEgressPrefix("/__platform_conn/conn-aaa/mcp")).toBe(
      "/mcp",
    );
    expect(stripConnectionEgressPrefix("/__platform_conn/conn-aaa/")).toBe("/");
  });

  /** TEST_SCENARIO: Most traffic carries no address at all, and a path that merely
   * looks like one must not be truncated into a different rule's path. */
  it("leaves an unaddressed path untouched", () => {
    expect(stripConnectionEgressPrefix("/mcp")).toBe("/mcp");
    expect(stripConnectionEgressPrefix("/__platform_conn/conn-aaa")).toBe(
      "/__platform_conn/conn-aaa",
    );
    expect(stripConnectionEgressPrefix("/a/b/__platform_conn/x/y")).toBe(
      "/a/b/__platform_conn/x/y",
    );
  });

  /** TEST_SCENARIO: Only the leading address is an address; one deeper in the path
   * is the upstream's own, and stripping it would rewrite a real request. */
  it("strips only the leading address", () => {
    expect(
      stripConnectionEgressPrefix(
        "/__platform_conn/conn-aaa/__platform_conn/conn-bbb/mcp",
      ),
    ).toBe("/__platform_conn/conn-bbb/mcp");
  });
});
