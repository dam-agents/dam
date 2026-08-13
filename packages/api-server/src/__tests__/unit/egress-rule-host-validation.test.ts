import { describe, it, expect } from "vitest";
import { egressRuleCreateInputSchema } from "api-server-api";

const base = {
  agentId: "a1",
  method: "GET",
  pathPattern: "/x",
  verdict: "allow" as const,
};

describe("egressRuleCreateInputSchema host validation", () => {
  it.each([
    "api.github.com",
    "example.com",
    "sub.domain.example.co.uk",
    "*.example.com",
    "10.0.0.1",
    "*",
  ])("accepts valid host %s", (host) => {
    expect(
      egressRuleCreateInputSchema.safeParse({ ...base, host }).success,
    ).toBe(true);
  });

  it.each([
    'evil.com" , "injected',
    "host\nkey: value",
    "a b",
    "https://example.com",
    "example.com/path",
    "",
  ])("rejects injection-shaped host %j", (host) => {
    expect(
      egressRuleCreateInputSchema.safeParse({ ...base, host }).success,
    ).toBe(false);
  });
});
