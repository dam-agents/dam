/**
 * TEST_OVERVIEW: An agent may hold several Connections to one service, each with
 * its own credential. The gateway tells them apart by the path the agent asks
 * for, so every MCP server entry a Connection contributes is delivered under a
 * per-Connection path on the real host. The gateway strips that path again
 * before the request leaves, so the upstream sees the address it published.
 */
import { describe, it, expect } from "vitest";
import type { Contribution } from "api-server-api";
import {
  applyConnectionEgressAddressing,
  connectionEgressPathPrefix,
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

  /** TEST_SCENARIO: Only the agent-facing address moves. Every other contribution
   * reaches its own rail unchanged. */
  it("leaves contributions of every other kind untouched", () => {
    const env: Contribution = {
      kind: "env",
      name: "GH_TOKEN",
      placeholder: "dummy-placeholder",
    };
    const out = applyConnectionEgressAddressing("conn-aaa", [
      inject("mcp.slack.com"),
      env,
    ]);
    expect(out).toContainEqual(env);
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
