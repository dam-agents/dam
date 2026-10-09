// TEST_OVERVIEW: a connection's host and header name are rendered into the agent's Envoy gateway, and its value format decides what the gateway injects. The create schema must refuse every input Envoy rejects or that would inject without the secret.
import { connectionCreateInputSchema } from "api-server-api";
import { describe, expect, it } from "vitest";

const header = {
  templateId: "custom-header",
  name: "my-api",
  authKind: "header" as const,
  host: "api.example.com",
  headerName: "X-Api-Key",
  value: "secret",
};

const mcp = {
  templateId: "custom-mcp-none",
  name: "my-mcp",
  authKind: "none" as const,
  url: "https://mcp.example.com/mcp",
};

const issues = (input: unknown): string[] => {
  const result = connectionCreateInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("connectionCreateInputSchema gateway-bound fields", () => {
  it.each([
    "api.example.com",
    "*.example.com",
    "https://api.my-cluster.example:6443",
    "api.my-cluster.example:6443",
    "10.0.0.1",
  ])("accepts host %s", (host) => {
    expect(issues({ ...header, host })).toEqual([]);
  });

  it.each([
    "*",
    "exa mple.com",
    "foo*.example.com",
    "*example.com",
    "https://*",
  ])("refuses host %s", (host) => {
    expect(issues({ ...header, host })).toEqual([
      expect.stringMatching(/host must be a DNS hostname/),
    ]);
  });

  it.each(["Bad Header:", "X Bad:Hdr", ":authority", "X-Key\r\n"])(
    "refuses header name %j",
    (headerName) => {
      expect(issues({ ...header, headerName })).toEqual([
        expect.stringMatching(/header name must be/),
      ]);
      expect(issues({ ...mcp, headerName, value: "v" })).toEqual([
        expect.stringMatching(/header name must be/),
      ]);
    },
  );

  it("accepts an RFC 7230 token header name", () => {
    expect(issues({ ...header, headerName: "X-Api_Key.v2" })).toEqual([]);
  });

  it("refuses a value format without {value}", () => {
    expect(issues({ ...header, valueFormat: "Bearer" })).toEqual([
      expect.stringMatching(/must contain \{value\}/),
    ]);
    expect(issues({ ...header, valueFormat: "Bearer {value}" })).toEqual([]);
  });

  it("refuses an MCP URL whose host is a bare wildcard", () => {
    expect(issues({ ...mcp, url: "https://*/mcp" })).toEqual([
      expect.stringMatching(/URL host must be a DNS hostname/),
    ]);
    expect(issues(mcp)).toEqual([]);
  });

  it("applies the same checks to client-credentials connections", () => {
    const cc = {
      templateId: "custom-client-credentials",
      name: "my-cc",
      authKind: "client-credentials" as const,
    };
    expect(issues({ ...cc, host: "*" })).toHaveLength(1);
    expect(issues({ ...cc, headerName: "Bad Header:" })).toHaveLength(1);
    expect(issues({ ...cc, valueFormat: "Bearer" })).toHaveLength(1);
  });
});
