import { describe, expect, it } from "vitest";
import { matchSavedServer } from "../modules/auth/domain/saved-server.js";
import { normalizeServerUrl } from "../modules/shared/server-url.js";

/**
 * TEST_OVERVIEW: A server's URL names one saved sign-in however the user
 * writes it. `normalizeServerUrl` gives the one form the CLI saves and
 * compares, and `matchSavedServer` finds the saved server that
 * `dam auth switch` was given, by URL or by host name alone.
 */

describe("normalizeServerUrl", () => {
  it.each([
    ["https://dam.example.com/", "https://dam.example.com"],
    ["https://dam.example.com", "https://dam.example.com"],
    ["https://DAM.example.com//", "https://dam.example.com"],
    ["http://dam.localhost:4444/", "http://dam.localhost:4444"],
    ["https://dam.example.com:443/", "https://dam.example.com"],
    ["https://example.com/dam/", "https://example.com/dam"],
    ["  https://dam.example.com/ ", "https://dam.example.com"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });
});

describe("matchSavedServer", () => {
  const saved = [
    "https://dev.example.com",
    "https://prod.example.com",
    "http://dam.localhost:4444",
  ];

  /** TEST_SCENARIO: the user copies the URL from the browser, with or without its trailing slash, and both name the saved server. */
  it.each([
    ["https://dev.example.com/", "https://dev.example.com"],
    ["https://dev.example.com", "https://dev.example.com"],
    ["dev.example.com", "https://dev.example.com"],
    ["dev.example.com/", "https://dev.example.com"],
    ["dam.localhost:4444", "http://dam.localhost:4444"],
    ["dam.localhost", "http://dam.localhost:4444"],
  ])("%s finds %s", (input, host) => {
    expect(matchSavedServer(input, saved)).toEqual({ kind: "found", host });
  });

  /** TEST_SCENARIO: a server the user never signed in to is unknown, also when only its scheme differs from a saved one, so a switch never silently changes the scheme. */
  it.each(["staging.example.com", "http://dev.example.com", "https://dev"])(
    "%s is unknown",
    (input) => {
      expect(matchSavedServer(input, saved)).toEqual({ kind: "unknown" });
    },
  );

  /** TEST_SCENARIO: one host name serves two saved servers on different ports; a bare host name cannot pick one, so the user is asked for the full URL. */
  it("a host name with two saved ports is ambiguous", () => {
    expect(
      matchSavedServer("dam.localhost", [
        "http://dam.localhost:4444",
        "http://dam.localhost:5555",
      ]),
    ).toEqual({
      kind: "ambiguous",
      candidates: ["http://dam.localhost:4444", "http://dam.localhost:5555"],
    });
  });
});
