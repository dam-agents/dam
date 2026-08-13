import { describe, expect, it } from "vitest";

import {
  canProbe,
  levelsUpTo,
  readPermissions,
  readRepositoryIds,
  writePermissions,
  writeRepositoryIds,
} from "@/modules/connections/lib/github-app-scope-fields";

describe("levelsUpTo", () => {
  it("offers no level above what the installation grants", () => {
    expect(levelsUpTo("read")).toEqual(["read"]);
    expect(levelsUpTo("write")).toEqual(["read", "write"]);
    expect(levelsUpTo("admin")).toEqual(["read", "write", "admin"]);
  });

  it("offers nothing for a level it does not recognise", () => {
    expect(levelsUpTo("banana")).toEqual([]);
  });
});

describe("permission field round-trip", () => {
  it("reads name:level pairs", () => {
    expect(readPermissions("contents:read issues:write")).toEqual({
      contents: "read",
      issues: "write",
    });
  });

  it("ignores half-typed text left in the field", () => {
    expect(readPermissions("contents: :read contents:banana ok:read")).toEqual({
      ok: "read",
    });
  });

  it("restores the original text after a permission is added then removed", () => {
    const start = "contents:read metadata:read";
    const selection = readPermissions(start);
    expect(writePermissions({ ...selection, issues: "write" })).toBe(
      "contents:read issues:write metadata:read",
    );
    expect(writePermissions(selection)).toBe(start);
  });

  it("serializes to the shape the server parses", () => {
    expect(writePermissions({ metadata: "read", contents: "write" })).toBe(
      "contents:write metadata:read",
    );
  });

  it("writes an empty string when nothing is selected", () => {
    expect(writePermissions({})).toBe("");
  });
});

describe("repository id field round-trip", () => {
  it("reads ids and skips anything non-numeric", () => {
    expect(readRepositoryIds("12 abc 34")).toEqual([12, 34]);
  });

  it("reads an empty field as no selection", () => {
    expect(readRepositoryIds("")).toEqual([]);
    expect(readRepositoryIds("   ")).toEqual([]);
  });

  it("writes ids in a stable order", () => {
    expect(writeRepositoryIds([34, 12])).toBe("12 34");
  });

  it("writes an empty string when nothing is selected", () => {
    expect(writeRepositoryIds([])).toBe("");
  });
});

describe("canProbe", () => {
  it("requires the app id, installation id, and private key", () => {
    expect(
      canProbe({ appId: "1", installationId: "2", privateKey: "pem" }),
    ).toBe(true);
    expect(canProbe({ appId: "1", installationId: "2" })).toBe(false);
    expect(
      canProbe({ appId: "1", installationId: "  ", privateKey: "pem" }),
    ).toBe(false);
    expect(canProbe({})).toBe(false);
  });

  it("additionally requires the host when the template needs one", () => {
    const withoutHost = { appId: "1", installationId: "2", privateKey: "pem" };
    expect(canProbe(withoutHost, true)).toBe(false);
    expect(canProbe({ ...withoutHost, host: "  " }, true)).toBe(false);
    expect(canProbe({ ...withoutHost, host: "ghe.acme.com" }, true)).toBe(true);
    expect(canProbe(withoutHost, false)).toBe(true);
  });
});
