/**
 * TEST_OVERVIEW: The reported case for two accounts of one service: two Custom
 * MCP connections added at the identical URL, each carrying its own secret in an
 * Authorization header. The two must reach the gateway as two distinct accounts,
 * so each one's MCP server entry has to be delivered under its own address.
 */
import { describe, it, expect } from "vitest";
import type { Contribution, SecretRef } from "api-server-api";
import { applyConnectionEgressAddressing } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { connectionSecretAnnotations } from "../../modules/connections/domain/connection-sds.js";

const URL_UNDER_TEST = "https://observe.example.com/api/mcp";

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

async function customMcpWithHeader(value: string): Promise<Contribution[]> {
  const template = buildCatalog().find((t) => t.id === "custom-mcp-none");
  if (!template) throw new Error("custom-mcp-none missing from catalog");
  const built = await buildConnection(
    template,
    {
      templateId: "custom-mcp-none",
      authKind: "none",
      name: "observe",
      url: URL_UNDER_TEST,
      headerName: "Authorization",
      value,
    },
    mintRef,
    "https://platform.example.com/api/oauth/callback",
    "Platform",
  );
  return built.contributions;
}

function urlOf(contributions: Contribution[]): string {
  const entry = contributions.find((c) => c.kind === "mcp-entry");
  if (entry?.kind !== "mcp-entry") throw new Error("no mcp-entry");
  return entry.url;
}

describe("two custom MCP connections at one URL, each with its own header secret", () => {
  /** TEST_SCENARIO: A header credential makes the connection something the gateway
   * injects for, which is what earns it an address. */
  it("contributes an injection on the MCP server's own host", () => {
    return customMcpWithHeader("secret-a").then((contributions) => {
      const inject = contributions.find((c) => c.kind === "egress-inject");
      expect(inject).toMatchObject({
        kind: "egress-inject",
        host: "observe.example.com",
        headerName: "Authorization",
      });
      expect(inject).not.toHaveProperty("pathPattern");
    });
  });

  /** TEST_SCENARIO: The reported failure: both entries were delivered at the plain
   * URL, so the gateway could not tell which account a request meant. */
  it("delivers each connection its own address at the same URL", async () => {
    const contributions = await customMcpWithHeader("secret-a");

    const first = urlOf(
      applyConnectionEgressAddressing("conn-aaa", contributions),
    );
    const second = urlOf(
      applyConnectionEgressAddressing("conn-bbb", contributions),
    );

    expect(first).toBe(
      "https://observe.example.com/__platform_conn/conn-aaa/api/mcp",
    );
    expect(second).toBe(
      "https://observe.example.com/__platform_conn/conn-bbb/api/mcp",
    );
    expect(first).not.toBe(second);
  });

  /** TEST_SCENARIO: The agent must not hold the secret. The gateway supplies the
   * header, so the entry carries no Authorization of its own. */
  it("hands the agent no credential of its own", async () => {
    const contributions = await customMcpWithHeader("secret-a");
    const entry = contributions.find((c) => c.kind === "mcp-entry");
    if (entry?.kind !== "mcp-entry") throw new Error("no mcp-entry");
    expect(entry.headers).toBeUndefined();
  });

  /** TEST_SCENARIO: The gateway reads the injection list off the Secret, so the
   * host it names must be the real one — the address lives only in the path. */
  it("names the real host on the Secret the gateway reads", async () => {
    const contributions = await customMcpWithHeader("secret-a");
    const annotations = connectionSecretAnnotations(contributions);
    const hosts = JSON.parse(
      annotations["agent-platform.ai/injection-hosts"] ?? "[]",
    ) as { host: string; headerName: string }[];
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.host).toBe("observe.example.com");
  });
});
