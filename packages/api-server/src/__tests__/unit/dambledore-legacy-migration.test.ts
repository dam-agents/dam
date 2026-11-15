// TEST_OVERVIEW: the migration that adds the assistant record's legacy flag marks
// TEST_OVERVIEW: every row that exists at upgrade time and reconstructs nothing:
// TEST_OVERVIEW: the rows only exist where the assistant shipped before this came,
// TEST_OVERVIEW: and any rule over the Agents' history would re-judge an account on
// TEST_OVERVIEW: every upgrade. The first version of it did exactly that, against the
// TEST_OVERVIEW: usage mirror's pseudonymized owner, so it could never have matched.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../db/drizzle/0142_dambledore_legacy.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("the legacy flag's migration", () => {
  // TEST_SCENARIO: it adds the column and marks every existing row, which is the safe default: the notice shows rather than being withheld from an account that was here first.
  it("marks every row that exists", () => {
    expect(migration).toMatch(
      /ADD COLUMN "legacy" boolean DEFAULT false NOT NULL/,
    );
    expect(migration).toMatch(
      /UPDATE "dambledore_provisioned" SET "legacy" = true/,
    );
  });

  // TEST_SCENARIO: it reads no Agent history, so nothing is reconstructed from tables that cannot answer the question — and no later upgrade re-decides an account.
  it("reconstructs nothing", () => {
    expect(migration).not.toMatch(/"agents"/);
    expect(migration).not.toMatch(/\bcreated_at\b/);
    expect(migration).not.toMatch(/\bowner_sub\b/);
  });
});
