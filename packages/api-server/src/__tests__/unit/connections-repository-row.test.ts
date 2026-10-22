import { describe, expect, it } from "vitest";
import { toConnection } from "../../modules/connections/infrastructure/connections-repository.js";

/**
 * TEST_OVERVIEW: every reader turns a stored Connection row into a Connection
 * through the same function. An auth payload the schema no longer accepts
 * reads as no Connection at all, and a contribution the schema no longer
 * accepts is dropped while the rest of the row survives.
 */

const row = {
  id: "conn-1",
  owner: "owner-sub",
  templateId: "custom-header",
  name: "Example",
  inputs: { host: "api.example.com" },
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: "conn-1", field: "value" },
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
  contributions: [
    {
      kind: "env",
      name: "EXAMPLE_TOKEN",
      placeholder: "dummy-placeholder",
    },
    { kind: "env", name: "", placeholder: "dummy-placeholder" },
  ],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("a stored Connection row", () => {
  it("reads into a Connection, keeping only the contributions that parse", () => {
    const conn = toConnection(row);
    expect(conn?.ownerId).toBe("owner-sub");
    expect(conn?.inputs).toEqual({ host: "api.example.com" });
    expect(conn?.contributions).toEqual([
      {
        kind: "env",
        name: "EXAMPLE_TOKEN",
        placeholder: "dummy-placeholder",
      },
    ]);
  });

  it("reads as no Connection when its auth no longer parses", () => {
    expect(toConnection({ ...row, auth: { kind: "gone" } })).toBeNull();
  });

  it("defaults missing inputs to an empty object", () => {
    expect(toConnection({ ...row, inputs: null })?.inputs).toEqual({});
  });
});
