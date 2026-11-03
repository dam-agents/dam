// TEST_OVERVIEW: the Network access list groups an agent's rules by where they came from, with the user's own first, filters them by a search over host, path, method and verdict, and checks a typed host against the same rule the api-server applies.
import type { EgressRuleView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  egressHostError,
  groupRules,
} from "../../modules/egress-rules/rule-groups.js";

const rule = (
  host: string,
  source: EgressRuleView["source"],
): EgressRuleView => ({
  id: host,
  agentId: "a",
  host,
  method: "*",
  pathPattern: "*",
  verdict: "allow",
  decidedBy: "u",
  decidedAt: "",
  source,
});

describe("groupRules", () => {
  // TEST_SCENARIO: the platform's Environments rule is listed in a group of its own, last, never among the owner's own rules, so its owner sees it was added for them.
  it("puts the platform's Environments rule in a group of its own", () => {
    expect(
      groupRules(
        [rule("*.env.example.com", "platform:environments"), rule("api.example.com", "manual")],
        "",
      ).map((g) => [g.key, g.rules.map((r) => r.host)]),
    ).toEqual([
      ["own", ["api.example.com"]],
      ["platform", ["*.env.example.com"]],
    ]);
  });

  const rules = [
    rule("pypi.org", "preset:trusted"),
    rule("api.example.com", "manual"),
    rule("github.com", "connection:c1"),
    rule("approved.dev", "inbox"),
  ];

  it("orders groups own, connection, preset and puts approvals with the user's own", () => {
    expect(
      groupRules(rules, "").map((g) => [g.key, g.rules.map((r) => r.host)]),
    ).toEqual([
      ["own", ["api.example.com", "approved.dev"]],
      ["connection", ["github.com"]],
      ["preset", ["pypi.org"]],
    ]);
  });

  it("drops groups with no match for the search", () => {
    expect(groupRules(rules, "PYPI").map((g) => g.key)).toEqual(["preset"]);
  });
});

describe("egressHostError", () => {
  it.each(["api.example.com", "*.example.com", "*", "host:8443", ""])(
    "accepts %s",
    (host) => expect(egressHostError(host)).toBeUndefined(),
  );

  it.each(["http://foo bar/x", "https://api.example.com", "foo*.example.com"])(
    "rejects %s",
    (host) => expect(egressHostError(host)).toBeDefined(),
  );
});
