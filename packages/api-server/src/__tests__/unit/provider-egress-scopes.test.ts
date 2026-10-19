// TEST_OVERVIEW: the egress gate lets a model provider Connection's own hosts pass over the Agent's deny rules. Only provider Connections count, and a scope covers a request only on its own host, port and path.
import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";
import {
  providerEgressScopes,
  scopeCovers,
} from "../../modules/connections/domain/provider-egress-scopes.js";

const connection = (
  templateId: string,
  contributions: Connection["contributions"],
): Pick<Connection, "templateId" | "contributions"> => ({
  templateId,
  contributions,
});

const inject = (host: string, pathPattern?: string) =>
  ({
    kind: "egress-inject",
    host,
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
    ...(pathPattern ? { pathPattern } : {}),
  }) as Connection["contributions"][number];

const request = { port: 443, tls: true };

describe("providerEgressScopes", () => {
  it("takes the egress hosts of provider Connections only", () => {
    expect(
      providerEgressScopes([
        connection("anthropic-oauth", [
          { kind: "env", name: "CLAUDE_CODE_OAUTH_TOKEN", placeholder: "x" },
          inject("api.anthropic.com"),
        ]),
        connection("github", [inject("api.github.com")]),
      ]),
    ).toEqual([{ host: "api.anthropic.com", pathPattern: "*" }]);
  });
});

describe("scopeCovers", () => {
  const openai = providerEgressScopes([
    connection("openai", [inject("api.openai.com", "/v1/*")]),
  ])[0]!;

  it("covers the scope's own path, in any host letter case", () => {
    expect(
      scopeCovers(openai, {
        ...request,
        host: "API.OpenAI.com",
        path: "/v1/responses",
      }),
    ).toBe(true);
  });

  it("does not cover another path, host or port", () => {
    expect(
      scopeCovers(openai, {
        ...request,
        host: "api.openai.com",
        path: "/v2/x",
      }),
    ).toBe(false);
    expect(
      scopeCovers(openai, { ...request, host: "openai.com", path: "/v1/x" }),
    ).toBe(false);
    expect(
      scopeCovers(openai, {
        host: "api.openai.com",
        port: 8443,
        tls: true,
        path: "/v1/x",
      }),
    ).toBe(false);
  });

  it("reads a dot in the pattern as a dot, not any character", () => {
    const scope = { host: "h.example", pathPattern: "/v1.json" };
    expect(
      scopeCovers(scope, { ...request, host: "h.example", path: "/v1.json" }),
    ).toBe(true);
    expect(
      scopeCovers(scope, { ...request, host: "h.example", path: "/v1xjson" }),
    ).toBe(false);
  });
});
