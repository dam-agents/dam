import { describe, expect, it } from "vitest";

import { hostMatchCandidates } from "../../modules/egress-rules/domain/host-match.js";

// TEST_OVERVIEW: the patterns a stored egress rule may use to speak for the host of one request, which is what the rule lookup matches on.
describe("hostMatchCandidates", () => {
  // TEST_SCENARIO: the trusted preset seeds `*.pkg.dev` for Artifact Registry, whose blobs arrive from a per-region host nobody can enumerate. That rule must speak for the region host, and the bare `*` must stay the last resort.
  it("covers the host itself, its parent wildcard, and the bare star", () => {
    expect(hostMatchCandidates("us-docker.pkg.dev")).toEqual([
      "us-docker.pkg.dev",
      "*.pkg.dev",
      "*",
    ]);
  });

  // TEST_SCENARIO: a wildcard stands for one label, like the SNI chain and the certificate SAN that enforce it, so a deeper host must not borrow its grandparent's rule.
  it("does not let a deeper host match a grandparent wildcard", () => {
    expect(hostMatchCandidates("a.b.pkg.dev")).toEqual([
      "a.b.pkg.dev",
      "*.b.pkg.dev",
      "*",
    ]);
    expect(hostMatchCandidates("a.b.pkg.dev")).not.toContain("*.pkg.dev");
  });

  // TEST_SCENARIO: a single-label host has no parent, and `*.` plus nothing would be a pattern no rule can hold.
  it("offers no wildcard for a host with no parent", () => {
    expect(hostMatchCandidates("localhost")).toEqual(["localhost", "*"]);
  });
});
