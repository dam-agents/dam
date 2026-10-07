// TEST_OVERVIEW: the gateway forwards to whatever port the request names, so the ext-authz Check must hand the gate the requested port and scheme, and a rule must speak only for its own port. A rule with no port speaks only for the scheme's default port: 443 for TLS, 80 for plain HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { startExtAuthzGrpcApp } from "../../apps/ext-authz/grpc.js";
import { rulePortCovers } from "../../modules/egress-rules/domain/port-match.js";
import {
  AuthorizationService,
  CheckRequest,
  type CheckResponse,
} from "../../proto-gen/external_auth.gen.js";
import type { DeepPartial } from "../../proto-gen/external_auth.gen.js";

describe("rulePortCovers", () => {
  it("lets a rule with port 8080 allow :8080 and nothing else", () => {
    expect(rulePortCovers(8080, 8080, true)).toBe(true);
    expect(rulePortCovers(8080, 8080, false)).toBe(true);
    expect(rulePortCovers(8080, 9090, true)).toBe(false);
    expect(rulePortCovers(8080, 443, true)).toBe(false);
  });

  it("lets a portless rule allow only 443 over TLS and 80 over plain HTTP", () => {
    expect(rulePortCovers(undefined, 443, true)).toBe(true);
    expect(rulePortCovers(undefined, 80, false)).toBe(true);
    expect(rulePortCovers(undefined, 8080, true)).toBe(false);
    expect(rulePortCovers(undefined, 8080, false)).toBe(false);
    expect(rulePortCovers(undefined, 80, true)).toBe(false);
    expect(rulePortCovers(undefined, 443, false)).toBe(false);
  });
});

describe("ext-authz gRPC Check: requested port and scheme", () => {
  const seen: Array<{ host: string; port: number; tls: boolean }> = [];
  const port = 40_000 + Math.floor(Math.random() * 20_000);
  let server: grpc.Server;
  let client: grpc.Client & {
    check(
      req: CheckRequest,
      cb: (err: grpc.ServiceError | null, res: CheckResponse) => void,
    ): void;
  };

  beforeAll(async () => {
    ({ server } = await startExtAuthzGrpcApp({
      port,
      holdSeconds: 30,
      releaseName: "rel",
      gate: {
        gateRequest: async ({ host, port, tls }) => {
          seen.push({ host, port, tls });
          return "allow";
        },
      },
    }));
    const Client = grpc.makeGenericClientConstructor(
      AuthorizationService,
      "Authorization",
    );
    client = new Client(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
      { "grpc.default_authority": "rel-extauthz-agent-1" },
    ) as unknown as typeof client;
  });

  afterAll(() => {
    client.close();
    server.forceShutdown();
  });

  async function check(attributes: DeepPartial<CheckRequest>["attributes"]) {
    seen.length = 0;
    const res = await new Promise<CheckResponse>((resolve, reject) =>
      client.check(CheckRequest.fromPartial({ attributes }), (err, r) =>
        err ? reject(err) : resolve(r),
      ),
    );
    return { code: res.status?.code, gate: seen[0] };
  }

  it("takes the port from the Host of a plain HTTP request", async () => {
    expect(
      await check({
        request: {
          http: { host: "api.x:8080", scheme: "http", method: "GET" },
        },
      }),
    ).toEqual({ code: 0, gate: { host: "api.x", port: 8080, tls: false } });
  });

  it("defaults plain HTTP to 80 and TLS-terminated HTTP to 443", async () => {
    expect(
      await check({
        request: { http: { host: "api.x", scheme: "http", method: "GET" } },
      }),
    ).toEqual({ code: 0, gate: { host: "api.x", port: 80, tls: false } });
    expect(
      await check({
        request: { http: { host: "api.x", scheme: "https", method: "GET" } },
      }),
    ).toEqual({ code: 0, gate: { host: "api.x", port: 443, tls: true } });
  });

  it("treats a CONNECT authority as TLS with its own port", async () => {
    expect(
      await check({
        request: {
          http: { host: "store.svc:8333", scheme: "http", method: "CONNECT" },
        },
      }),
    ).toEqual({ code: 0, gate: { host: "store.svc", port: 8333, tls: true } });
  });

  // TEST_SCENARIO: the L4 catch-all sees only SNI and always dials 443, so an SNI-only Check is TLS on 443.
  it("treats an SNI-only Check as TLS on 443", async () => {
    expect(await check({ tlsSession: { sni: "api.x" } })).toEqual({
      code: 0,
      gate: { host: "api.x", port: 443, tls: true },
    });
  });

  it("denies a malformed port without asking the gate", async () => {
    expect(
      await check({
        request: {
          http: { host: "api.x:80ab", scheme: "http", method: "GET" },
        },
      }),
    ).toEqual({ code: 7, gate: undefined });
  });
});
