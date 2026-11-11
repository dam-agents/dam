import { describe, expect, it } from "vitest";

import { reachesPastDriver } from "../../modules/egress-rules/domain/driver-reach.js";

// TEST_OVERVIEW: whether a rule a driver sets on its open child lets through a request (a host, port, method and path) the driver's own rules do not allow, which is what makes the rule wait for the owner while the owner has not let the driver's children have network access of their own.
const allow = (
  host: string,
  extra: { port?: number; path?: string; method?: string } = {},
) => ({
  host,
  ...(extra.port !== undefined && { port: extra.port }),
  method: extra.method ?? "*",
  pathPattern: extra.path ?? "*",
  verdict: "allow",
});
const deny = (host: string, path = "*", method = "*") => ({
  host,
  method,
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

  // TEST_SCENARIO: a deny on the driver under a more specific host pattern beats its wider allow, as at the gate. A host-wide deny makes every child rule for the host wider. A deny of one path makes a host-wide child rule wider, since it would let that path through, and leaves a child rule for another path within reach.
  it("reads the driver's denies the way the gate does", () => {
    expect(
      reachesPastDriver({ host: "gist.github.com" }, [
        allow("*.github.com"),
        deny("gist.github.com"),
      ]),
    ).toBe(true);
    const adminDenied = [
      allow("*.github.com"),
      deny("gist.github.com", "/admin/*"),
    ];
    expect(reachesPastDriver({ host: "gist.github.com" }, adminDenied)).toBe(
      true,
    );
    expect(
      reachesPastDriver(
        { host: "gist.github.com", pathPattern: "/raw/*" },
        adminDenied,
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: a driver its owner limited to some paths or one method of a host cannot give its child the rest of the host: the child's rule is within reach only when one allow of the driver speaks for every request it lets through.
  it("compares methods and paths", () => {
    const readOnly = [
      allow("api.github.com", { path: "/repos/*", method: "GET" }),
    ];
    expect(reachesPastDriver({ host: "api.github.com" }, readOnly)).toBe(true);
    expect(
      reachesPastDriver(
        { host: "api.github.com", method: "POST", pathPattern: "/repos/*" },
        readOnly,
      ),
    ).toBe(true);
    expect(
      reachesPastDriver(
        { host: "api.github.com", method: "GET", pathPattern: "/users/*" },
        readOnly,
      ),
    ).toBe(true);
    expect(
      reachesPastDriver(
        { host: "api.github.com", method: "GET", pathPattern: "/repos/*" },
        readOnly,
      ),
    ).toBe(false);
    expect(
      reachesPastDriver(
        {
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/acme/*",
        },
        readOnly,
      ),
    ).toBe(false);
    expect(
      reachesPastDriver(
        { host: "api.github.com", method: "GET", pathPattern: "/repos/*" },
        [allow("api.github.com")],
      ),
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

describe("a driver's deny beside its allow", () => {
  // TEST_SCENARIO: the gate matches a path pattern with LIKE, so a deny of `/*` or `**` stops every path as `*` does; a driver with `allow *` and any deny on github.com that a host-wide child rule would let through (every path, one path, one method) does not allow all of github.com, so that child rule is wider. A child rule the deny cannot match stays within reach.
  it("makes a child rule the deny may match wider", () => {
    for (const blocked of [
      deny("github.com", "*"),
      deny("github.com", "/*"),
      deny("github.com", "**"),
      deny("github.com", "%/*"),
      deny("github.com", "/"),
      deny("github.com", "*", "POST"),
    ])
      expect(
        reachesPastDriver({ host: "github.com" }, [allow("*"), blocked]),
      ).toBe(true);
    expect(
      reachesPastDriver({ host: "github.com", method: "GET" }, [
        allow("*"),
        deny("github.com", "*", "POST"),
      ]),
    ).toBe(false);
  });

  // TEST_SCENARIO: an allow beside a host-wide deny on the same host gives the child what the gate gives the driver: the named path, where the gate ranks the allow first, and not the rest of the host; a host-wide allow ties with the deny and is read as wider.
  it("lets a child rule within an allow the gate ranks first through", () => {
    const reposOnly = [
      allow("github.com", { path: "/repos/*" }),
      deny("github.com"),
    ];
    expect(
      reachesPastDriver(
        { host: "github.com", pathPattern: "/repos/*" },
        reposOnly,
      ),
    ).toBe(false);
    expect(reachesPastDriver({ host: "github.com" }, reposOnly)).toBe(true);
    expect(
      reachesPastDriver({ host: "github.com", pathPattern: "/repos/*" }, [
        allow("github.com", { path: "/repos/*" }),
        deny("github.com", "/*"),
      ]),
    ).toBe(false);
    expect(
      reachesPastDriver({ host: "github.com" }, [
        allow("github.com"),
        deny("github.com", "/*"),
      ]),
    ).toBe(true);
  });
});
