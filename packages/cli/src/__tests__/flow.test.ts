import { describe, expect, it } from "vitest";
import { nextFlowStep } from "../modules/auth/domain/flow.js";
import type { TokenEndpointResponse } from "../modules/auth/domain/tokens.js";

const STARTED_AT = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-01-01T00:00:30Z"); // 30s elapsed
const EXPIRES_IN = 600;
const INTERVAL = 5;

function err(error: string, error_description?: string): TokenEndpointResponse {
  return { kind: "error", error, error_description };
}

function success(): TokenEndpointResponse {
  return {
    kind: "success",
    access_token: "AT",
    refresh_token: "RT",
    expires_in: 3600,
    token_type: "Bearer",
  };
}

describe("nextFlowStep", () => {
  it("authorization_pending → poll-again at the current interval", () => {
    const step = nextFlowStep({
      response: err("authorization_pending"),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step).toEqual({ action: "poll-again", intervalSeconds: 5 });
  });

  it("slow_down → poll-again at interval + 5 (RFC 8628 §3.5, test claim 6)", () => {
    const step = nextFlowStep({
      response: err("slow_down"),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step).toEqual({ action: "poll-again", intervalSeconds: 10 });
  });

  it("repeated slow_down compounds the interval +5 each time", () => {
    let interval = INTERVAL;
    for (let i = 0; i < 3; i++) {
      const step = nextFlowStep({
        response: err("slow_down"),
        currentIntervalSeconds: interval,
        startedAt: STARTED_AT,
        now: NOW,
        expiresInSeconds: EXPIRES_IN,
      });
      if (step.action !== "poll-again") throw new Error("expected poll-again");
      interval = step.intervalSeconds;
    }
    expect(interval).toBe(20); // 5 → 10 → 15 → 20
  });

  it("access_denied → fail(\"access-denied\") and forwards description", () => {
    const step = nextFlowStep({
      response: err("access_denied", "user clicked deny"),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step).toEqual({
      action: "fail",
      reason: "access-denied",
      message: "user clicked deny",
    });
  });

  it("expired_token → fail(\"expired-token\") (test claim 6, terminal half)", () => {
    const step = nextFlowStep({
      response: err("expired_token"),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step.action).toBe("fail");
    if (step.action === "fail") expect(step.reason).toBe("expired-token");
  });

  it("200 success → succeed and forwards token fields", () => {
    const step = nextFlowStep({
      response: success(),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step).toEqual({
      action: "succeed",
      tokens: {
        accessToken: "AT",
        refreshToken: "RT",
        expiresIn: 3600,
        tokenType: "Bearer",
      },
    });
  });

  it("unknown error string → fail(\"unexpected-response\")", () => {
    const step = nextFlowStep({
      response: err("totally_made_up_error"),
      currentIntervalSeconds: INTERVAL,
      startedAt: STARTED_AT,
      now: NOW,
      expiresInSeconds: EXPIRES_IN,
    });
    expect(step.action).toBe("fail");
    if (step.action === "fail") {
      expect(step.reason).toBe("unexpected-response");
      expect(step.message).toContain("totally_made_up_error");
    }
  });

  it("client-side timeout (now - startedAt >= expiresIn) → fail(\"expired-token\") regardless of response", () => {
    const step = nextFlowStep({
      // Even with an apparent success response, the device code is past
      // its server-advertised lifetime; refuse to commit.
      response: success(),
      currentIntervalSeconds: INTERVAL,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-01-01T00:10:00Z"), // 600s elapsed
      expiresInSeconds: 600,
    });
    expect(step.action).toBe("fail");
    if (step.action === "fail") expect(step.reason).toBe("expired-token");
  });

  it("on boundary (now - startedAt exactly equals expiresIn) → expired-token", () => {
    // RFC says "after expires_in seconds the device code is no longer
    // valid" — the boundary is inclusive of expiry.
    const step = nextFlowStep({
      response: err("authorization_pending"),
      currentIntervalSeconds: INTERVAL,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-01-01T00:10:00Z"),
      expiresInSeconds: 600,
    });
    expect(step.action).toBe("fail");
    if (step.action === "fail") expect(step.reason).toBe("expired-token");
  });
});
