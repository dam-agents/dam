import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:tls";
import type { AddressInfo } from "node:net";
import { probeClusterCa } from "../../modules/connections/infrastructure/cluster-ca-probe.js";
import {
  TEST_CLUSTER_CERT as TEST_CERT,
  TEST_CLUSTER_KEY as TEST_KEY,
} from "../helpers/test-cluster-cert.js";

describe("probeClusterCa", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) =>
      socket.end(),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it("reports a self-signed endpoint as reachable but not trusted", async () => {
    const result = await probeClusterCa(`127.0.0.1:${port}`);
    expect(result.reachable).toBe(true);
    expect(result.trusted).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("reports unreachable for a dead endpoint without throwing", async () => {
    const result = await probeClusterCa("127.0.0.1:1");
    expect(result.reachable).toBe(false);
    expect(result.trusted).toBe(false);
  });
});
