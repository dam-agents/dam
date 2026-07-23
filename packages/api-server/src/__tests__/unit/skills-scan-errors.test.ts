import { describe, it, expect } from "vitest";
import {
  AgentRuntimeUnreachableError,
  AgentRuntimeUpstreamError,
} from "../../modules/skills/infrastructure/agent-runtime-client.js";
import {
  privateScanErrorToTrpc,
  SCAN_ACCESS_MESSAGE,
} from "../../modules/skills/infrastructure/upstream-to-trpc.js";

function upstream(status: number, body?: Record<string, string>) {
  return new AgentRuntimeUpstreamError("agent-runtime scan a: boom", {
    status,
    ...(body !== undefined ? { body } : {}),
  });
}

describe("privateScanErrorToTrpc", () => {
  it.each([
    ["404 (ungranted or nonexistent repo)", upstream(404)],
    ["401 (no connection — sentinel reached GitHub unswapped)", upstream(401)],
    [
      "upstream_unreachable (pod couldn't reach GitHub)",
      upstream(0, { error: "upstream_unreachable", message: "fetch failed" }),
    ],
  ])("maps %s to the hedged grant-access FORBIDDEN", (_label, err) => {
    const trpc = privateScanErrorToTrpc(err);
    expect(trpc?.code).toBe("FORBIDDEN");
    expect(trpc?.message).toBe(SCAN_ACCESS_MESSAGE);
  });

  it("keeps other upstream statuses on the upstreamToTrpc translation", () => {
    const trpc = privateScanErrorToTrpc(
      upstream(403, { message: "scope missing" }),
    );
    expect(trpc?.code).toBe("FORBIDDEN");
    expect(trpc?.message).toMatch(/Reconnect GitHub/);
  });

  it("maps a pod that never answered to a retryable error, not grant-access", () => {
    const trpc = privateScanErrorToTrpc(
      new AgentRuntimeUnreachableError("agent-runtime scan a: fetch failed"),
    );
    expect(trpc?.code).toBe("INTERNAL_SERVER_ERROR");
    expect(trpc?.message).not.toBe(SCAN_ACCESS_MESSAGE);
    expect(trpc?.message).toMatch(/re-scan/);
  });

  it("declines errors it doesn't own so callers rethrow them raw", () => {
    expect(privateScanErrorToTrpc(new Error("fetch failed"))).toBeNull();
  });
});
