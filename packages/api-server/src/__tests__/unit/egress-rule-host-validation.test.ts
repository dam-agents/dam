import { describe, it, expect } from "vitest";
import { egressRuleCreateInputSchema } from "api-server-api";

// A narrowed rule's host is promoted onto the gateway's Envoy bootstrap
// (an unescaped text/template field) and cert SANs (#2865). The input
// schema rejects anything that isn't a DNS hostname so no quote, newline,
// or YAML metacharacter can reach the rendered config.
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
    "*", // deny-all / trusted-none host — stays on L4, never promoted
  ])("accepts valid host %s", (host) => {
    expect(
      egressRuleCreateInputSchema.safeParse({ ...base, host }).success,
    ).toBe(true);
  });

  it.each([
    'evil.com" , "injected', // YAML string breakout
    "host\nkey: value", // newline injection
    "a b", // whitespace
    "https://example.com", // scheme / slashes
    "example.com/path", // slash
    "", // empty
  ])("rejects injection-shaped host %j", (host) => {
    expect(
      egressRuleCreateInputSchema.safeParse({ ...base, host }).success,
    ).toBe(false);
  });
});
