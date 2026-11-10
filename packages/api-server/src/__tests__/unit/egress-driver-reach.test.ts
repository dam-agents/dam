import { describe, expect, it } from "vitest";

import { reachesPastDriver } from "../../modules/egress-rules/domain/driver-reach.js";

// TEST_OVERVIEW: whether a rule a driver sets on its open child reaches a host and port the driver's own rules do not, which is what makes the rule wait for the owner while the owner has not let the driver's children have network access of their own.
const allow = (host: string, extra: { port?: number; path?: string } = {}) => ({
  host,
  ...(extra.port !== undefined && { port: extra.port }),
  method: "*",
  pathPattern: extra.path ?? "*",
  verdict: "allow",
});
const deny = (host: string, path = "*") => ({
  host,
  method: "*",
  pathPattern: path,
  verdict: "deny",
});

describe("reachesPastDriver", () => {
  // TEST_SCENARIO: a host the driver has no rule for is wider, and one it allows is not.
  it("is wider for a host the driver has no rule for", () => {
    expect(reachesPastDriver({ host: "pypi.org" }, [allow("github.com")])).toBe(
      true,
    );
    expect(
      reachesPastDriver({ host: "GitHub.com" }, [allow("github.com")]),
    ).toBe(false);
  });

  // TEST_SCENARIO: the driver's wildcard speaks for the one label under it, as at the gate, and its bare * for everything.
  it("lets the driver's wildcard rules reach the hosts under them", () => {
    expect(
      reachesPastDriver({ host: "api.github.com" }, [allow("*.github.com")]),
    ).toBe(false);
    expect(
      reachesPastDriver({ host: "a.b.github.com" }, [allow("*.github.com")]),
    ).toBe(true);
    expect(reachesPastDriver({ host: "pypi.org" }, [allow("*")])).toBe(false);
  });

  // TEST_SCENARIO: a host-wide deny on the driver beats its wider allow, as the most specific rule wins at the gate; a deny of one path leaves the host reachable, since the child reaches only what the driver could reach on another path.
  it("reads the driver's denies the way the gate does", () => {
    expect(
      reachesPastDriver({ host: "gist.github.com" }, [
        allow("*.github.com"),
        deny("gist.github.com"),
      ]),
    ).toBe(true);
    expect(
      reachesPastDriver({ host: "gist.github.com" }, [
        allow("*.github.com"),
        deny("gist.github.com", "/admin/*"),
      ]),
    ).toBe(false);
  });

  // TEST_SCENARIO: a driver that reaches a host on some path reaches the host, so a child's rule for its other paths is not wider.
  it("compares hosts and ports, not paths", () => {
    expect(
      reachesPastDriver({ host: "api.github.com" }, [
        allow("api.github.com", { path: "/repos/*" }),
      ]),
    ).toBe(false);
  });

  // TEST_SCENARIO: a rule with no port speaks for 443 and 80, and a rule with a port only for that port, so a driver allowed on 443 does not reach 8080, and a child's rule for 8080 is wider.
  it("compares ports as the gate does", () => {
    expect(
      reachesPastDriver({ host: "ci.internal", port: 8080 }, [
        allow("ci.internal"),
      ]),
    ).toBe(true);
    expect(
      reachesPastDriver({ host: "ci.internal", port: 8080 }, [
        allow("ci.internal", { port: 8080 }),
      ]),
    ).toBe(false);
    expect(
      reachesPastDriver({ host: "ci.internal" }, [
        allow("ci.internal", { port: 443 }),
      ]),
    ).toBe(true);
  });
});
