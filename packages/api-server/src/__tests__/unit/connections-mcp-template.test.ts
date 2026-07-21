import { describe, expect, it } from "vitest";
import type { SecretRef } from "api-server-api";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function mcpNoneTemplate() {
  const t = buildCatalog().find((t) => t.id === "custom-mcp-none");
  if (!t) throw new Error("custom-mcp-none template missing from catalog");
  return t;
}

describe("custom-mcp-none build", () => {
  it("without a header credential stays auth-less", async () => {
    const built = await buildConnection(
      mcpNoneTemplate(),
      {
        templateId: "custom-mcp-none",
        authKind: "none",
        name: "plain-mcp",
        url: "https://mcp.example.com/sse",
      },
      mintRef,
      "http://cb",
      "Test",
    );

    expect(built.auth.kind).toBe("none");
    expect(built.secrets.size).toBe(0);
    expect(built.contributions).toEqual([
      { kind: "egress-allow", host: "mcp.example.com" },
      {
        kind: "mcp-entry",
        name: "custom-mcp-none",
        url: "https://mcp.example.com/sse",
      },
    ]);
  });

  it("with a header credential injects at the gateway, not the mcp-entry", async () => {
    const built = await buildConnection(
      mcpNoneTemplate(),
      {
        templateId: "custom-mcp-none",
        authKind: "none",
        name: "keyed-mcp",
        url: "https://mcp.example.com:8443/sse",
        headerName: "X-API-Key",
        value: "s3cret",
      },
      mintRef,
      "http://cb",
      "Test",
    );

    expect(built.auth).toMatchObject({
      kind: "header",
      headerName: "X-API-Key",
      valueFormat: "{value}",
      valueRef: { path: "secret-connection:custom-mcp-none", field: "value" },
    });

    const inject = built.contributions.find((c) => c.kind === "egress-inject");
    expect(inject).toMatchObject({
      host: "mcp.example.com",
      port: 8443,
      headerName: "X-API-Key",
      valueFormat: "{value}",
    });

    const mcpEntry = built.contributions.find((c) => c.kind === "mcp-entry");
    expect(mcpEntry).toMatchObject({ url: "https://mcp.example.com:8443/sse" });
    expect(mcpEntry).not.toHaveProperty("headers");

    const secret = built.secrets.get("secret-connection:custom-mcp-none");
    expect(secret?.value).toBe("s3cret");
    expect(JSON.stringify(built.contributions)).not.toContain("s3cret");
  });
});
