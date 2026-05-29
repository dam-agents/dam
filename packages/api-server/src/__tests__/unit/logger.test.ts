import { describe, it, expect } from "vitest";
import { configureLogger, getLogger } from "../../core/logger.js";
import { securityLog } from "../../core/security-log.js";

/** Capture sink — each test installs a fresh Pino instance writing here, with
 *  an explicit level so singleton state doesn't leak between cases. */
function capture(level: "error" | "warn" | "info" | "debug" = "info") {
  const lines: string[] = [];
  configureLogger({ level, write: (line) => lines.push(line) });
  return {
    lines,
    records: () => lines.map((l) => JSON.parse(l)),
    raw: () => lines.join(""),
  };
}

describe("logger (pino-backed)", () => {
  it("emits one JSON object per call with string level, ISO time, and the event as msg", () => {
    const cap = capture("info");
    securityLog("info", "egress.decision", {
      category: "egress",
      actor: "kc-1",
      actorKind: "agent",
      decision: "allow",
    });
    expect(cap.lines).toHaveLength(1);
    const rec = cap.records()[0]!;
    expect(rec.level).toBe("info");
    expect(rec.msg).toBe("egress.decision");
    expect(rec.category).toBe("egress");
    expect(rec.decision).toBe("allow");
    expect(typeof rec.time).toBe("string");
    expect(() => new Date(rec.time).toISOString()).not.toThrow();
  });

  it("gates by configured level — debug suppressed at info; warn/error always emit", () => {
    const cap = capture("info");
    getLogger().debug("noisy");
    getLogger().info("kept");
    getLogger().warn("kept-warn");
    getLogger().error("kept-error");
    expect(cap.records().map((r) => r.msg)).toEqual([
      "kept",
      "kept-warn",
      "kept-error",
    ]);
  });

  it("raising the level to warn drops info/debug (the audit-trail dial)", () => {
    const cap = capture("warn");
    securityLog("info", "authz.allow", {
      category: "authz",
      actor: "kc-1",
      actorKind: "user",
    });
    securityLog("warn", "authn.deny", {
      category: "authn",
      actor: null,
      actorKind: "external",
    });
    expect(cap.records().map((r) => r.msg)).toEqual(["authn.deny"]);
  });

  it("does not throw on unserializable (circular) fields", () => {
    const cap = capture("info");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      securityLog("info", "secret.create", {
        category: "credential",
        actor: "kc-1",
        actorKind: "user",
        detail: circular,
      }),
    ).not.toThrow();
    expect(cap.records()[0]!.msg).toBe("secret.create");
  });

  it("censors well-known credential keys as defense-in-depth", () => {
    const cap = capture("info");
    getLogger().info({ token: "xoxb-leak", note: "ok" }, "oops");
    expect(cap.raw()).not.toContain("xoxb-leak");
    expect(cap.raw()).toContain("[REDACTED]");
  });
});

describe("securityLog", () => {
  it("writes at the given common level and always carries category", () => {
    const cap = capture("info");
    securityLog("warn", "authn.deny", {
      category: "authn",
      actor: null,
      actorKind: "external",
      result: "failure",
      reason: "JWTExpired",
    });
    const rec = cap.records()[0]!;
    expect(rec.level).toBe("warn");
    expect(rec.msg).toBe("authn.deny");
    expect(rec.category).toBe("authn");
    expect(rec.actor).toBe(null);
    expect(rec.reason).toBe("JWTExpired");
  });
});
