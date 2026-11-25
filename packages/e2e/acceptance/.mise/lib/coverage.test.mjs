import assert from "node:assert/strict";
import { test } from "node:test";

import { capabilityOf, report } from "./coverage.mjs";

const covered = (rules) =>
  `Feature: f\n${Array.from({ length: rules }, (_, i) => `  Rule: r${i}\n    Example: e${i}\n      Given a\n      When b\n      Then c\n`).join("")}`;

test("a capability counts its Rules and Examples", () => {
  const row = capabilityOf("agents", "editors", covered(2));
  assert.equal(row.rules, 2);
  assert.equal(row.examples, 2);
  assert.equal(row.todo, 0);
});

test("a stub counts every Rule as todo", () => {
  const row = capabilityOf("agents", "editors", "@todo\nFeature: f\n  Rule: a\n  Rule: b\n");
  assert.equal(row.todo, 2);
  assert.equal(report([row])[0].note, "todo");
});

test("a capability with some Rules still todo says how many", () => {
  const source = `${covered(1)}\n  @todo\n  Rule: later\n`;
  const [row] = report([capabilityOf("agents", "editors", source)]);
  assert.equal(row.todo, 1);
  assert.match(row.note, /1 Rule todo$/);
});

test("a capability whose Rules pass three times the median is flagged, and one at the median is not", () => {
  const rows = report([
    capabilityOf("a", "one", covered(2)),
    capabilityOf("a", "two", covered(2)),
    capabilityOf("a", "three", covered(2)),
    capabilityOf("a", "big", covered(7)),
  ]);
  assert.match(rows.find((r) => r.capability === "big").note, /× the median of 2 Rules/);
  assert.equal(rows.find((r) => r.capability === "one").note, "");
});

test("journeys cross capabilities, so the report leaves them out", () => {
  const journey = capabilityOf("journeys", "first-use", "@journey @ui\nFeature: j\n  Scenario: s\n    Given a\n    When b\n    Then c\n");
  assert.deepEqual(report([journey]), []);
});
