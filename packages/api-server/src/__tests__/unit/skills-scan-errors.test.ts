import { describe, it, expect } from "vitest";
import {
  AgentRuntimeUnreachableError,
  AgentRuntimeUpstreamError,
} from "../../modules/skills/infrastructure/agent-runtime-client.js";
import {
  hasScanFailure,
  privateScanFailure,
  scanFailureError,
} from "../../modules/skills/infrastructure/upstream-to-trpc.js";

function upstream(status: number, body?: Record<string, string>) {
  return new AgentRuntimeUpstreamError("agent-runtime scan a: boom", {
    status,
    ...(body !== undefined ? { body } : {}),
  });
}

describe("privateScanFailure", () => {
  it.each([
    ["404 (ungranted or nonexistent repo)", upstream(404)],
    ["401 (no connection — sentinel reached GitHub unswapped)", upstream(401)],
    [
      "upstream_unreachable (pod couldn't reach GitHub)",
      upstream(0, { error: "upstream_unreachable", message: "fetch failed" }),
    ],
  ])("maps %s to the hedged repo-access verdict", (_label, err) => {
    expect(privateScanFailure(err)?.code).toBe("repo_unreachable");
  });

  it("names GitHub and its status for any other upstream answer", () => {
    const failure = privateScanFailure(upstream(403, { message: "boom" }));
    expect(failure?.code).toBe("other");
    expect(failure?.detail).toMatch(/status 403/);
  });

  it("keeps the upstream body out of the verdict", () => {
    const failure = privateScanFailure(
      upstream(500, { message: "<html><body>gateway</body></html>" }),
    );
    expect(`${failure?.title} ${failure?.detail}`).not.toMatch(/html/);
  });

  it("maps a pod that never answered to the sandbox verdict, not repo access", () => {
    const failure = privateScanFailure(
      new AgentRuntimeUnreachableError("agent-runtime scan a: fetch failed"),
    );
    expect(failure?.code).toBe("agent_unreachable");
  });

  it("declines errors it doesn't own so the caller's catch-all classifies them", () => {
    expect(privateScanFailure(new Error("fetch failed"))).toBeNull();
  });
});

describe("scanFailureError", () => {
  // tRPC wraps a non-Error cause in an UnknownCauseError, copying own
  // properties across — so the verdict is read off the cause, not compared to it.
  it("carries the verdict on the cause so the errorFormatter can lift it", () => {
    const err = scanFailureError("needs_github_connection");
    expect(hasScanFailure(err)).toBe(true);
    expect(
      (err.cause as unknown as { scanFailure: unknown }).scanFailure,
    ).toEqual({
      code: "needs_github_connection",
      title: "Can't load skills from this source",
      detail:
        "The repository may be private or the URL may not be valid. " +
        "Add a GitHub connection or check the URL, then re-scan.",
    });
  });

  it("leaves a readable sentence on `message` for callers that only have it", () => {
    expect(scanFailureError("repo_unreachable").message).toMatch(
      /^Can't access this repository\. If it's private/,
    );
  });

  it("does not report a plain error as carrying a verdict", () => {
    expect(hasScanFailure(new Error("boom"))).toBe(false);
  });
});
