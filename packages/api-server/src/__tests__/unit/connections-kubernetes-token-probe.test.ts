import { createServer as createPlainServer } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { probeKubernetesToken } from "../../modules/connections/infrastructure/kubernetes-token-probe.js";
import {
  TEST_CLUSTER_CERT,
  TEST_CLUSTER_KEY,
  TEST_OTHER_CLUSTER_CERT,
} from "../helpers/test-cluster-cert.js";

/**
 * TEST_OVERVIEW: a Kubernetes service-account token is checked on its
 * cluster's API server before it is saved, with a SelfSubjectReview posted
 * with the token and the cluster's CA. A 201 passes and names the user the
 * token acts as, and the expiry comes from the token's `exp` claim. A 401
 * fails, saying the token expired when its claim is past. A certificate the
 * given CA, or the public roots without one, does not trust fails as kubectl
 * would, and so does any other TLS error. A cluster too old for
 * SelfSubjectReview, another answer or a timeout leaves the token
 * unchecked; the timeout is a deadline for the whole request.
 */

interface Seen {
  method?: string;
  url?: string;
  authorization?: string;
  body: string;
}

let server: Server;
let port: number;
let answer: {
  status: number;
  body?: unknown;
  hang?: boolean;
  drip?: boolean;
};
let seen: Seen[];

function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

const target = (caPem: string | null = TEST_CLUSTER_CERT) => ({
  host: "127.0.0.1",
  port,
  ...(caPem ? { caPem } : {}),
});

beforeAll(async () => {
  server = createServer(
    { key: TEST_CLUSTER_KEY, cert: TEST_CLUSTER_CERT },
    (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
        });
        if (answer.hang) return;
        if (answer.drip) {
          res.writeHead(answer.status, { "Content-Type": "application/json" });
          const tick = setInterval(() => res.write(" "), 50);
          res.on("close", () => clearInterval(tick));
          return;
        }
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
      });
    },
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  server.closeAllConnections();
});

afterAll(() => {
  server.close();
});

describe("Kubernetes token check", () => {
  beforeAll(() => {
    seen = [];
  });

  // TEST_SCENARIO: the cluster accepts the token; the check names the service account it acts as and the expiry its JWT claims, so a 24-hour token shortened by EKS shows as such.
  it("passes a token the cluster accepts and names its user", async () => {
    seen = [];
    answer = {
      status: 201,
      body: {
        kind: "SelfSubjectReview",
        status: {
          userInfo: { username: "system:serviceaccount:ops:deployer" },
        },
      },
    };
    const token = jwt({ exp: 1_792_800_000, sub: "x" });
    await expect(probeKubernetesToken(target(), token, 5_000)).resolves.toEqual(
      {
        status: "passed",
        account: "system:serviceaccount:ops:deployer",
        expiresAt: new Date(1_792_800_000 * 1000).toISOString(),
      },
    );
    expect(seen).toEqual([
      {
        method: "POST",
        url: "/apis/authentication.k8s.io/v1/selfsubjectreviews",
        authorization: `Bearer ${token}`,
        body: expect.stringContaining('"kind":"SelfSubjectReview"'),
      },
    ]);
  });

  // TEST_SCENARIO: a token that is not a JWT, as some clusters issue, still passes; the check only has no expiry to show.
  it("passes an opaque token with no expiry", async () => {
    answer = {
      status: 201,
      body: { status: { userInfo: { username: "admin" } } },
    };
    await expect(
      probeKubernetesToken(target(), "opaque-token", 5_000),
    ).resolves.toEqual({ status: "passed", account: "admin" });
  });

  // TEST_SCENARIO: the cluster refuses the token; a token whose claim is past says it expired, which is the usual cause for a service-account token.
  it("fails a refused token and says when it expired", async () => {
    answer = { status: 401, body: { kind: "Status", code: 401 } };
    await expect(
      probeKubernetesToken(target(), "opaque-token", 5_000),
    ).resolves.toEqual({
      status: "failed",
      reason: "the cluster refused the token (HTTP 401)",
    });
    const expired = jwt({ exp: 1_700_000_000 });
    await expect(
      probeKubernetesToken(target(), expired, 5_000),
    ).resolves.toEqual({
      status: "failed",
      reason: `the cluster refused the token, which expired ${new Date(1_700_000_000_000).toISOString()}`,
    });
  });

  // TEST_SCENARIO: without the cluster's CA, a self-signed API server is not trusted; the check fails before the token is sent and says to give the CA.
  it("fails a cluster certificate the public roots do not trust", async () => {
    seen = [];
    answer = { status: 201, body: {} };
    const outcome = await probeKubernetesToken(
      target(null),
      "opaque-token",
      5_000,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toMatch(
      /not publicly trusted.*give the cluster's CA/,
    );
    expect(seen).toEqual([]);
  });

  // TEST_SCENARIO: a CA from another cluster does not trust this one, so the wrong CA fails too.
  it("fails a cluster certificate the given CA does not trust", async () => {
    const outcome = await probeKubernetesToken(
      target(TEST_OTHER_CLUSTER_CERT),
      "opaque-token",
      5_000,
    );
    expect(outcome).toEqual({
      status: "failed",
      reason:
        "the cluster's certificate does not match the CA given (DEPTH_ZERO_SELF_SIGNED_CERT)",
    });
  });

  // TEST_SCENARIO: a cluster older than Kubernetes 1.28 has no SelfSubjectReview; that says nothing about the token, so it stays unchecked with the reason.
  it("leaves the token unchecked on a cluster without SelfSubjectReview", async () => {
    answer = { status: 404, body: {} };
    await expect(
      probeKubernetesToken(target(), "opaque-token", 5_000),
    ).resolves.toEqual({
      status: "unchecked",
      reason:
        "the cluster does not offer SelfSubjectReview, which Kubernetes 1.28 added",
    });
  });

  // TEST_SCENARIO: a 5xx or a 403 says nothing about the token either.
  it("leaves the token unchecked on another answer", async () => {
    answer = { status: 503 };
    await expect(
      probeKubernetesToken(target(), "opaque-token", 5_000),
    ).resolves.toEqual({
      status: "unchecked",
      reason:
        "the cluster answered HTTP 503, which says nothing about the token",
    });
  });

  // TEST_SCENARIO: an API server that sends its answer a little at a time, never idle but never done, is cut off at the deadline, so a save never waits longer than the timeout.
  it("cuts off an answer that drips past the deadline", async () => {
    answer = { status: 201, drip: true };
    const started = Date.now();
    await expect(
      probeKubernetesToken(target(), "opaque-token", 300),
    ).resolves.toEqual({
      status: "unchecked",
      reason: "the cluster's API server did not answer in time",
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  // TEST_SCENARIO: a TLS error that is not a trust error, such as a server that speaks no TLS, fails too, as kubectl would refuse it.
  it("fails a TLS error that is not a trust error", async () => {
    const plain = createPlainServer((_req, res) => res.end("{}"));
    await new Promise<void>((resolve) =>
      plain.listen(0, "127.0.0.1", () => resolve()),
    );
    const plainPort = (plain.address() as AddressInfo).port;
    try {
      const outcome = await probeKubernetesToken(
        { host: "127.0.0.1", port: plainPort, caPem: TEST_CLUSTER_CERT },
        "opaque-token",
        5_000,
      );
      expect(outcome).toEqual({
        status: "failed",
        reason: "the TLS connection to the cluster failed (EPROTO)",
      });
    } finally {
      plain.close();
    }
  });

  // TEST_SCENARIO: an API server that does not answer in time leaves the token unchecked with a fixed reason.
  it("leaves the token unchecked when the cluster does not answer", async () => {
    answer = { status: 201, hang: true };
    await expect(
      probeKubernetesToken(target(), "opaque-token", 200),
    ).resolves.toEqual({
      status: "unchecked",
      reason: "the cluster's API server did not answer in time",
    });
  });
});
