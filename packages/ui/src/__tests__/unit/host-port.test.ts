import { describe, expect, test } from "vitest";

import {
  formatHostPort,
  splitHostPort,
} from "../../modules/egress-rules/host-port.js";

describe("splitHostPort", () => {
  test("splits a trailing port", () => {
    expect(splitHostPort("api.cluster.example:6443")).toEqual({
      host: "api.cluster.example",
      port: 6443,
    });
  });

  test("normalizes :443 away", () => {
    expect(splitHostPort("api.example.com:443")).toEqual({
      host: "api.example.com",
    });
  });

  test("bare host has no port", () => {
    expect(splitHostPort("api.example.com")).toEqual({
      host: "api.example.com",
    });
  });

  test.each([
    "api.example.com:abc",
    "api.example.com:",
    "api.example.com:70000",
    "::1",
    "[::1]:6443",
  ])("leaves non-host:port input untouched: %s", (raw) => {
    expect(splitHostPort(raw)).toEqual({ host: raw });
  });

  test("round-trips through formatHostPort", () => {
    for (const raw of ["api.example.com:6443", "api.example.com"]) {
      expect(formatHostPort(splitHostPort(raw))).toBe(raw);
    }
  });
});
