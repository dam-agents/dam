import { describe, expect, test } from "vitest";

import { PROVIDER_ROWS } from "../../modules/providers/lib/provider-rows.js";
import { PROVIDER_PRESET_TYPES, PROVIDERS } from "../../types.js";

describe("PROVIDER_ROWS parity with the preset registry", () => {
  test("offers a row for every provider preset", () => {
    const offered = new Set(PROVIDER_ROWS.map((row) => row.type));
    const missing = PROVIDER_PRESET_TYPES.filter((t) => !offered.has(t));

    expect(missing).toEqual([]);
  });

  test("offers no row for a preset that does not exist", () => {
    const known = new Set<string>(PROVIDER_PRESET_TYPES);
    const unknown = PROVIDER_ROWS.map((row) => row.type).filter(
      (t) => !known.has(t),
    );

    expect(unknown).toEqual([]);
  });

  test("lists each preset exactly once", () => {
    const types = PROVIDER_ROWS.map((row) => row.type);

    expect(types).toHaveLength(new Set(types).size);
  });

  test("gives every offered row a description and a display name", () => {
    for (const row of PROVIDER_ROWS) {
      expect(row.description.trim()).not.toBe("");
      expect(PROVIDERS[row.type].displayName.trim()).not.toBe("");
    }
  });
});
