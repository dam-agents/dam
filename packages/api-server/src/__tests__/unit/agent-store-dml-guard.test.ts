import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// TEST_OVERVIEW: the api-server owns the control tables, so nothing structural stops it from writing what the controller owns — only this guard does. It fails when api-server code writes the controller's observation tables or the controller's columns on the shared signals row, so such a write has to arrive as a deliberate edit here rather than as a line in a diff nobody looked at twice.

const SOURCE_ROOT = new URL("../../", import.meta.url).pathname;

const OBSERVATION_TABLES = {
  identifiers: ["controlAgentStatus", "controlAgentConditions"],
  names: ["agent_status", "agent_conditions"],
};

const RECLAIM_COLUMNS = [
  "reclaimed_at",
  "reclaimed_activity_token",
  "reclaimedAt",
  "reclaimedActivityToken",
];

const READ_ONLY_ADAPTER = /^control-read(-[a-z]+)*\.ts$/u;

const quoted = (name: string): string => `"?${name}"?`;

const writesTo = (name: string): RegExp =>
  new RegExp(
    `\\b(insert\\s+into|update|delete\\s+from|truncate|drop\\s+table|alter\\s+table)\\s+${quoted("control")}\\s*\\.\\s*${quoted(name)}\\b`,
    "iu",
  );

const builderWrite = (identifier: string): RegExp =>
  new RegExp(`\\b(insert|update|delete)\\s*\\(\\s*${identifier}\\b`, "u");

const builderCall = /\b(insert|update|delete)\s*\(/u;

const snakeColumns = RECLAIM_COLUMNS.filter((column) => column.includes("_"));
const camelColumns = RECLAIM_COLUMNS.filter((column) => !column.includes("_"));
const reclaimWrite = new RegExp(
  [
    `\\b(${snakeColumns.join("|")})\\s*=\\s*[^=]`,
    `\\.(set|values)\\(\\{[^}]*\\b(${camelColumns.join("|")})\\b`,
  ].join("|"),
  "su",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .filter((entry) => !entry.parentPath.includes("__tests__"))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("api-server writes to what the controller owns", () => {
  // TEST_SCENARIO: The observation tables are the controller's, and raw SQL counts: a query string names a table without the schema's identifiers, so matching identifiers alone would let a write through, and quoting either name would too.
  it("never writes an observation table", () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const found = [
        ...OBSERVATION_TABLES.names.filter((name) =>
          writesTo(name).test(source),
        ),
        ...OBSERVATION_TABLES.identifiers.filter((identifier) =>
          builderWrite(identifier).test(source),
        ),
      ];
      return found.length === 0
        ? []
        : [`${path.replace(SOURCE_ROOT, "")} writes ${found.join(", ")}`];
    });

    expect(offenders).toEqual([]);
  });

  // TEST_SCENARIO: Reading an observation needs the schema's side to reach it, and only a module whose name says read-only may. Naming the tables anywhere else is either a write this guard does not recognize or a second read path that skipped review.
  it("lets only a read-only adapter name the observation tables", () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const names = OBSERVATION_TABLES.identifiers.filter((identifier) =>
        source.includes(identifier),
      );
      if (names.length === 0) return [];
      if (!READ_ONLY_ADAPTER.test(basename(path)))
        return [`${path.replace(SOURCE_ROOT, "")} names ${names.join(", ")}`];
      return [];
    });

    expect(offenders).toEqual([]);
  });

  // TEST_SCENARIO: A read-only adapter's name is a promise, so it is checked rather than trusted: an insert, update or delete builder in one would make the exemption the hole it exists to close.
  it("keeps the read-only adapter free of write builders", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => READ_ONLY_ADAPTER.test(basename(path)))
      .filter((path) => builderCall.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
  });

  // TEST_SCENARIO: The signals row is shared, and two of its columns are the controller's alone — the api-server may read the reclaim mark and put it in a row it describes, but must never set or clear it, whichever side of the switch holds the row. A write is a raw `SET`, or a value handed to a Drizzle `set`/`values`.
  it("never writes the controller's reclaim columns", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => reclaimWrite.test(readFileSync(path, "utf8")))
      .map((path) => path.replace(SOURCE_ROOT, ""));

    expect(offenders).toEqual([]);
  });

  // TEST_SCENARIO: A guard that scans nothing passes for the wrong reason. The walker must find the module that does name control tables — the grant reconcile — so an empty file list fails here rather than passing.
  it("scans files that do name control tables", () => {
    const names = sourceFiles(SOURCE_ROOT).filter((path) =>
      readFileSync(path, "utf8").includes("control.agents"),
    );

    expect(names.length).toBeGreaterThan(0);
  });
});
